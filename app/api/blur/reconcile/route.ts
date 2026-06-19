import { NextRequest } from "next/server";
import { getReplicate } from "@/lib/blur/replicate";
import { findStuckJobs, updateJob } from "@/lib/blur/jobs";
import { advance, kickOff } from "@/lib/blur/state";

export const runtime = "nodejs";
export const maxDuration = 300;

const STUCK_AFTER_MS = 10 * 60 * 1000; // 10 min in a non-terminal state
const MAX_KICK_ATTEMPTS = 3; // give a lost kickoff a few tries before failing it

/**
 * Reconciliation cron (PRD §10): a webhook can be lost. Find jobs stuck in a
 * non-terminal state and either:
 *   - poll Replicate for their latest stage's prediction and advance/fail them, or
 *   - re-kick a job whose pipeline kickoff was lost (status `uploaded`, no
 *     prediction id) — e.g. a transient Replicate 402/429/5xx at create left it
 *     orphaned. Without this such a job would never advance and never fail.
 * Idempotent: re-advancing an already-final job is a no-op-ish update.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` when CRON_SECRET
 * is set in the project env.
 */
export async function GET(req: NextRequest) {
  if (
    !process.env.CRON_SECRET ||
    req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return new Response("Unauthorized", { status: 401 });
  }

  const stuck = await findStuckJobs(STUCK_AFTER_MS);
  if (stuck.length === 0) return Response.json({ checked: 0, results: [] });

  const replicate = getReplicate(); // only instantiate when there's work to poll
  const results: Array<Record<string, unknown>> = [];

  for (const job of stuck) {
    const preds = job.predictionIds ?? {};
    // Poll the most recent stage that has a Replicate prediction.
    const stage = preds.cog
      ? "cog"
      : preds.track
        ? "track"
        : preds.detect
          ? "detect"
          : null;
    const predId = stage ? preds[stage] : undefined;

    // No prediction was ever created for this job — it can't be polled.
    if (!stage || !predId) {
      if (job.status === "uploaded") {
        // Kickoff was lost. Re-kick from the stored raw upload, capped so a
        // permanently-broken asset can't loop forever (and burn credit).
        const attempts = (job.attempts ?? 0) + 1;
        if (attempts > MAX_KICK_ATTEMPTS) {
          await updateJob(job.id, {
            status: "failed",
            error: "pipeline failed to start after retries",
            attempts,
          });
          results.push({ job: job.id, failed: "kickoff" });
          continue;
        }
        await updateJob(job.id, { attempts });
        try {
          await kickOff(job);
          results.push({ job: job.id, rekicked: true, attempts });
        } catch (err) {
          // Still failing — leave it `uploaded`; the next run retries (the
          // attempt was already counted, so it converges on `failed`).
          results.push({ job: job.id, kick_error: String((err as Error).message) });
        }
      } else {
        // In-flight (detecting/tracking/compositing) but with no prediction to
        // poll — an inconsistent dead end. Fail it so a human/retry can see it.
        await updateJob(job.id, {
          status: "failed",
          error: `stuck in ${job.status} with no prediction to poll`,
        });
        results.push({ job: job.id, failed: "orphaned" });
      }
      continue;
    }

    const pred = await replicate.predictions.get(predId);
    if (pred.status === "succeeded") {
      await advance(job.id, stage, { output: pred.output });
      results.push({ job: job.id, recovered: stage });
    } else if (pred.status === "failed" || pred.status === "canceled") {
      await advance(job.id, stage, { error: String(pred.error ?? "prediction failed") });
      results.push({ job: job.id, failed: stage });
    } else {
      results.push({ job: job.id, still: pred.status });
    }
  }

  return Response.json({ checked: stuck.length, results });
}
