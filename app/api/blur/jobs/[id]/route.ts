import { NextRequest } from "next/server";
import { getJob } from "@/lib/blur/jobs";
import { presignPrivateGet } from "@/lib/blob";
import { hasDeliverableWebhook } from "@/lib/blur/config";
import { getReplicate } from "@/lib/blur/replicate";
import { advance } from "@/lib/blur/state";

export const runtime = "nodejs";

type Job = NonNullable<Awaited<ReturnType<typeof getJob>>>;
type PredictionStage = "cog" | "detect" | "track";

function activePrediction(job: Job) {
  const preds = job.predictionIds ?? {};
  const stage: PredictionStage | null =
    job.status === "detecting"
      ? preds.cog
        ? "cog"
        : preds.detect
          ? "detect"
          : null
      : job.status === "tracking" && preds.track
        ? "track"
        : null;

  return stage ? { stage, id: preds[stage] } : null;
}

async function advanceLocalWebhookStandIn(job: Job) {
  if (hasDeliverableWebhook() || !process.env.REPLICATE_API_TOKEN) return job;

  const active = activePrediction(job);
  if (!active?.id) return job;

  const pred = await getReplicate().predictions.get(active.id);
  if (pred.status === "succeeded") {
    await advance(job.id, active.stage, { output: pred.output });
    return (await getJob(job.id)) ?? job;
  }
  if (pred.status === "failed" || pred.status === "canceled") {
    await advance(job.id, active.stage, {
      error: pred.error ? String(pred.error) : "prediction failed",
    });
    return (await getJob(job.id)) ?? job;
  }

  return job;
}

// Next 16: dynamic route params are async — `await ctx.params`.
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const initialJob = await getJob(id);
  const job = initialJob ? await advanceLocalWebhookStandIn(initialJob) : null;
  if (!job) return Response.json({ error: "Job not found" }, { status: 404 });
  const previewUrl = job.blurredBlobUrl
    ? await presignPrivateGet(job.blurredBlobUrl, 300)
    : null;

  // Status-poll shape — never leak blob keys/prediction ids to the client.
  return Response.json({
    id: job.id,
    status: job.status,
    mediaType: job.mediaType,
    previewUrl,
    regions: job.regions,
    detectionConfidence: job.detectionConfidence,
    error: job.error,
    updatedAt: job.updatedAt,
  });
}
