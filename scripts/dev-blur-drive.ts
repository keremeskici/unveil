/**
 * DEV ONLY — webhook stand-in for local runs.
 *
 * On localhost, Replicate can't deliver the stage-completion webhooks
 * (NEXT_PUBLIC_APP_URL=http://localhost:3000 is unreachable from their side), so
 * a job started by the real /api/posts upload would sit in `detecting` forever.
 * This drives it the same way the reconcile cron does: poll the active stage's
 * prediction and call the production `advance()` when it finishes — walking
 * detect → track → composite until the job is ready_for_review (or fails).
 *
 *   dotenv -e .env.local -- tsx scripts/dev-blur-drive.ts <jobId>
 */
import { getJob } from "@/lib/blur/jobs";
import { advance, kickOff } from "@/lib/blur/state";
import { getReplicate } from "@/lib/blur/replicate";

const TERMINAL = new Set([
  "ready_for_review",
  "approved",
  "published",
  "manual_review",
  "failed",
]);
const POLL_MS = 4000;
const MAX_ITERS = 200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const jobId = process.argv[2];
  if (!jobId) throw new Error("usage: dev-blur-drive.ts <jobId>");
  const replicate = getReplicate();

  let last = "";
  for (let i = 0; i < MAX_ITERS; i++) {
    const job = await getJob(jobId);
    if (!job) throw new Error(`job ${jobId} not found`);
    if (job.status !== last) {
      console.log(`[${i}] status=${job.status} preds=${JSON.stringify(job.predictionIds ?? {})}`);
      last = job.status;
    }
    if (TERMINAL.has(job.status)) {
      console.log(`\nDONE → ${job.status}`);
      if (job.status === "ready_for_review") {
        console.log(`regions=${(job.regions ?? []).length} patches=${(job.regionPatches ?? []).length}`);
        const tracked = (job.regionPatches ?? []).filter((p) => p.track?.length);
        console.log(`tracked patches=${tracked.length}` + (tracked[0] ? ` (track points=${tracked[0].track!.length})` : ""));
      }
      return;
    }

    const preds = job.predictionIds ?? {};
    // Poll the most recent stage that has a prediction (latest first).
    const stage = preds.cog ? "cog" : preds.track ? "track" : preds.detect ? "detect" : null;
    const predId = stage ? preds[stage] : undefined;

    if (!stage || !predId) {
      // Kickoff was lost (or hasn't happened) — re-kick from the stored upload.
      if (job.status === "uploaded") {
        console.log(`[${i}] no prediction yet → kickOff`);
        await kickOff({ id: job.id, rawBlobKey: job.rawBlobKey, mediaType: job.mediaType }).catch(
          (e) => console.error("kickOff failed (will retry):", e?.message ?? e),
        );
      }
      await sleep(POLL_MS);
      continue;
    }

    const pred = await replicate.predictions.get(predId);
    if (pred.status === "succeeded") {
      console.log(`[${i}] stage=${stage} succeeded → advance`);
      await advance(jobId, stage, { output: pred.output });
    } else if (pred.status === "failed" || pred.status === "canceled") {
      console.log(`[${i}] stage=${stage} ${pred.status} → advance(error)`);
      await advance(jobId, stage, { error: pred.error ? String(pred.error) : "prediction failed" });
    } else {
      // starting / processing — keep waiting.
      process.stdout.write(`\r[${i}] stage=${stage} ${pred.status}…            `);
    }
    await sleep(POLL_MS);
  }
  throw new Error("gave up after max iterations");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
