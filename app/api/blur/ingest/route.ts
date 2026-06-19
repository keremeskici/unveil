import { NextRequest } from "next/server";
import { createJob } from "@/lib/blur/jobs";
import { kickOff } from "@/lib/blur/state";

// Postgres + Supabase Storage signing + video keyframe extraction need Node.
export const runtime = "nodejs";
// Just enough to create the job and kick off the first stage — NOT to process.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { rawBlobKey, creatorId, mediaType, postId } = (await req.json()) as {
    rawBlobKey?: string;
    creatorId?: string;
    mediaType?: "image" | "video";
    postId?: string;
  };

  if (!rawBlobKey || !creatorId || (mediaType !== "image" && mediaType !== "video")) {
    return Response.json({ error: "Missing/invalid fields" }, { status: 400 });
  }

  // 1. Persist a job row (status: 'uploaded').
  const job = await createJob({ rawBlobKey, creatorId, mediaType, postId });

  // 2. Kick off the pipeline (presign + create prediction + webhook); do NOT
  //    await completion. Replicate calls /api/blur/webhook as each stage finishes.
  try {
    await kickOff(job);
    return Response.json({ jobId: job.id, status: "detecting" });
  } catch (err) {
    // The create call failed transiently — leave the job `uploaded` with no
    // prediction id so the reconcile cron re-kicks it. Report it honestly
    // rather than claiming "detecting".
    console.error("blur pipeline trigger failed (will be reconciled):", err);
    return Response.json({ jobId: job.id, status: "uploaded" });
  }
}
