import { eq, and, inArray, lt, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  blurJobs,
  blurWebhookEvents,
  blurCostLog,
  blurStatusEnum,
  posts,
  postRegions,
  type RegionPatch,
} from "@/lib/db/schema";

// Non-terminal states a job can get stuck in if a webhook is missed.
const IN_FLIGHT: BlurStatus[] = ["uploaded", "detecting", "tracking", "compositing"];

export type BlurStatus = (typeof blurStatusEnum.enumValues)[number];
type JobPatch = Partial<typeof blurJobs.$inferInsert>;

export async function createJob(input: {
  creatorId: string;
  mediaType: "image" | "video";
  rawBlobKey: string;
  postId?: string | null;
}) {
  const db = getDb();
  const [job] = await db
    .insert(blurJobs)
    .values({
      creatorId: input.creatorId,
      mediaType: input.mediaType,
      rawBlobKey: input.rawBlobKey,
      postId: input.postId ?? null,
      status: "uploaded",
    })
    .returning();
  return job;
}

export async function getJob(id: string) {
  return getDb().query.blurJobs.findFirst({ where: eq(blurJobs.id, id) });
}

export type BlurJob = NonNullable<Awaited<ReturnType<typeof getJob>>>;

export async function updateJob(id: string, patch: JobPatch) {
  const db = getDb();
  const [job] = await db
    .update(blurJobs)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(blurJobs.id, id))
    .returning();
  return job;
}

/** Merge one stage's prediction id into the predictionIds jsonb map. */
export async function addPredictionId(id: string, stage: string, predictionId: string) {
  const db = getDb();
  await db
    .update(blurJobs)
    .set({
      predictionIds: sql`COALESCE(${blurJobs.predictionIds}, '{}'::jsonb) || ${JSON.stringify(
        { [stage]: predictionId },
      )}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(blurJobs.id, id));
}

/**
 * Approve → publish (P3). Atomically creates the public `posts` row from the
 * job's blurred derivative and flips the job to `published`. Both blob fields
 * store PATHNAMES (this store is private-only; the feed presigns on demand —
 * same convention as scripts/seed.ts). Nothing is public until this runs.
 */
export async function publishJob(
  jobId: string,
  opts: { title?: string; unlockPrice?: string; accessMode?: "full" | "partial" } = {},
) {
  return getDb().transaction(async (tx) => {
    const job = await tx.query.blurJobs.findFirst({ where: eq(blurJobs.id, jobId) });
    if (!job) throw new Error("job not found");
    if (job.status !== "ready_for_review" && job.status !== "approved") {
      throw new Error(`job not approvable (status=${job.status})`);
    }
    if (!job.blurredBlobUrl) throw new Error("job has no blurred derivative");

    // Approve request overrides the draft captured at upload; fall back to it.
    const title = opts.title?.trim() || job.draftTitle || "Untitled";
    const unlockPrice = opts.unlockPrice || job.draftPrice || "0.05";

    // Partial publishing requires crops produced during tracking. If the creator
    // asks for partial but there are none, fall back to a normal full-gate post.
    const patches = (job.regionPatches ?? []) as RegionPatch[];
    const partial =
      opts.accessMode === "partial" &&
      job.mediaType === "video" &&
      patches.length > 0;

    const [post] = await tx
      .insert(posts)
      .values({
        creatorId: job.creatorId,
        title,
        blurredPreviewUrl: job.blurredBlobUrl, // pathname — feed presigns it
        privateMediaKey: job.originalBlobKey ?? job.rawBlobKey,
        unlockPrice,
        mediaType: job.mediaType,
        accessMode: partial ? "partial" : "full",
        isPublished: true,
      })
      .returning();

    if (partial) {
      await tx.insert(postRegions).values(
        patches.map((p, i) => ({
          postId: post.id,
          label: p.label,
          rect: p.rect,
          patchMediaKey: p.patchKey,
          position: i,
        })),
      );
    }

    const [updated] = await tx
      .update(blurJobs)
      .set({ status: "published", postId: post.id, updatedAt: new Date() })
      .where(eq(blurJobs.id, jobId))
      .returning();

    return { post, job: updated };
  });
}

// ── Webhook idempotency ───────────────────────────────────────────────────────
/**
 * Atomically claim a webhook event. Returns true only the FIRST time an event
 * id is seen; a duplicate/retried event (or a concurrent retry that races a
 * slow handler) returns false and must be skipped. INSERT … ON CONFLICT DO
 * NOTHING RETURNING gives us the claim in a single round-trip.
 */
export async function claimWebhookEvent(
  eventId: string,
  jobId?: string,
): Promise<boolean> {
  const rows = await getDb()
    .insert(blurWebhookEvents)
    .values({ id: eventId, jobId: jobId ?? null })
    .onConflictDoNothing()
    .returning({ id: blurWebhookEvents.id });
  return rows.length > 0;
}

// ── Cost / observability ──────────────────────────────────────────────────────
export async function logCost(input: {
  jobId?: string | null;
  stage: string;
  predictTime?: number | null;
  status: string;
}) {
  await getDb().insert(blurCostLog).values({
    jobId: input.jobId ?? null,
    stage: input.stage,
    predictTime: input.predictTime != null ? String(input.predictTime) : null,
    status: input.status,
  });
}

// ── Reconciliation ────────────────────────────────────────────────────────────
/** Jobs in a non-terminal state whose last update is older than the cutoff —
 *  candidates for a missed-webhook poll. */
export async function findStuckJobs(olderThanMs: number) {
  const cutoff = new Date(Date.now() - olderThanMs);
  return getDb().query.blurJobs.findMany({
    where: and(inArray(blurJobs.status, IN_FLIGHT), lt(blurJobs.updatedAt, cutoff)),
    limit: 50,
  });
}
