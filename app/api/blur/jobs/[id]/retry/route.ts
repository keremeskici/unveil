import { NextRequest } from "next/server";
import { getJob, updateJob } from "@/lib/blur/jobs";
import { kickOff } from "@/lib/blur/state";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_ATTEMPTS = 3;

// Jobs whose pipeline never produced a reviewable preview — the creator can
// kick the auto-blur off again from the stored raw upload.
const RETRYABLE = ["uploaded", "failed", "manual_review"];

/**
 * Manual retry. Re-kicks detection for a job that's `failed`, fell back to
 * `manual_review`, or is stuck in `uploaded` because its kickoff was lost
 * (transient Replicate error at create). Unlike reject's "adjust", this re-runs
 * with the SAME params — it's "try again", not "try harder". Capped so a
 * permanently-broken asset can't be retried (and billed) forever.
 */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const job = await getJob(id);
  if (!job) return Response.json({ error: "Job not found" }, { status: 404 });

  if (!RETRYABLE.includes(job.status)) {
    return Response.json(
      { error: `Job is ${job.status} — nothing to retry` },
      { status: 409 },
    );
  }

  const attempts = (job.attempts ?? 0) + 1;
  if (attempts > MAX_ATTEMPTS) {
    await updateJob(id, { status: "manual_review", attempts });
    return Response.json(
      { error: "Retry limit reached — sent to manual review", status: "manual_review" },
      { status: 409 },
    );
  }

  // Optimistically reset to `uploaded` (clearing any prior error) so a transient
  // failure below lands in the exact state the reconcile cron re-kicks.
  await updateJob(id, { status: "uploaded", attempts, error: null });
  try {
    await kickOff(job);
    return Response.json({ status: "detecting", attempts });
  } catch (err) {
    await updateJob(id, { status: "failed", error: String((err as Error).message) });
    return Response.json(
      { error: "Could not start processing — try again shortly" },
      { status: 502 },
    );
  }
}
