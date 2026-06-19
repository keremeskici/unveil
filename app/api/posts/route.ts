import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { uploadPrivate, presignPrivateGet } from "@/lib/blob";
import {
  markUserCreator,
  getPostsByCreator,
} from "@/lib/db/queries";
import { formatUsd } from "@/lib/constants";
import { createJob, updateJob } from "@/lib/blur/jobs";
import {
  requireCurrentAppUser,
  unauthorizedJson,
  UnauthorizedError,
} from "@/lib/app-user";

export const runtime = "nodejs";

/**
 * GET /api/posts — a creator's own posts. Powers the "attach locked
 * content" picker in DMs (creator-only PPV). Previews are presigned for display.
 */
export async function GET() {
  let user;
  try {
    user = await requireCurrentAppUser();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedJson();
    throw err;
  }

  const rows = await getPostsByCreator(user.id);
  const posts = await Promise.all(
    rows.map(async (p) => ({
      id: p.id,
      title: p.title,
      unlockPrice: p.unlockPrice,
      priceLabel: `$${formatUsd(p.unlockPrice)}`,
      mediaType: p.mediaType,
      previewUrl: await presignPrivateGet(p.blurredPreviewUrl, 3600),
    })),
  );
  return Response.json({ posts });
}

// Soft cap to stay well under serverless request-body limits. Large videos
// should use a direct Supabase Storage upload flow — a follow-up.
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Creator upload. The UPLOAD side of the auto-blur flow (Option A):
 *   1. store the raw media as a private object (this is what the blur pipeline reads)
 *   2. enqueue a `blur_jobs` row (status "uploaded") carrying the draft caption +
 *      price — the POST itself is created later, at approve, by publishJob()
 *   3. best-effort kick off detection IF Replicate is configured (never blocks)
 *
 * No post is created here: nothing is public until the creator approves the blur
 * (auto-blur PRD §11, fail-closed). The detection/compositing/publish ("blur
 * flow") is a separate workstream; this route just hands off a clean `uploaded`
 * job + raw blob + draft metadata in the shape `lib/blur` expects.
 *
 *   POST /api/posts  (multipart/form-data: file, title, price)
 */
export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireCurrentAppUser();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedJson();
    throw err;
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  const title = (form.get("title") as string | null)?.trim() ?? "";
  const price = (form.get("price") as string | null)?.trim() ?? "";

  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: "Media file is required" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: "File too large (max 25 MB for now)" },
      { status: 413 },
    );
  }
  if (!title) {
    return Response.json({ error: "Caption is required" }, { status: 400 });
  }
  const priceNum = Number(price);
  if (!Number.isFinite(priceNum) || priceNum < 0) {
    return Response.json({ error: "Invalid price" }, { status: 400 });
  }

  const mediaType: "image" | "video" = file.type.startsWith("video")
    ? "video"
    : "image";

  // 1. Store the raw upload privately. The pipeline presigns this on demand.
  const creator = await markUserCreator(user.id);
  const ext =
    file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") ||
    (mediaType === "video" ? "mp4" : "jpg");
  const buffer = Buffer.from(await file.arrayBuffer());

  let rawBlobKey: string;
  try {
    const blob = await uploadPrivate(
      `uploads/${creator.id}/${randomUUID()}.${ext}`,
      buffer,
      {
        contentType: file.type || "application/octet-stream",
      },
    );
    rawBlobKey = blob.pathname;
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 502 },
    );
  }

  // 2. Blur job (the handoff) carrying the draft caption + price. publishJob()
  //    creates the public post from these at approve time.
  const job = await createJob({ creatorId: creator.id, mediaType, rawBlobKey });
  await updateJob(job.id, {
    draftTitle: title,
    draftPrice: priceNum.toFixed(8),
  });

  // 4. Optional handoff trigger via the blur pipeline's canonical entry point
  //    (`kickOff` routes to the single Cog or the multi-stage chain). Only if
  //    Replicate is configured; never let a failure fail the upload.
  const blurConfigured =
    !!process.env.REPLICATE_API_TOKEN &&
    (!!process.env.REPLICATE_VEIL_AUTOBLUR_VERSION ||
      (mediaType === "image"
        ? !!process.env.REPLICATE_GROUNDED_SAM_VERSION
        : !!process.env.REPLICATE_GROUNDING_DINO_VERSION));

  if (blurConfigured) {
    try {
      const { kickOff } = await import("@/lib/blur/state");
      await kickOff({ id: job.id, rawBlobKey, mediaType });
    } catch (err) {
      // Non-fatal: the Replicate `create` can fail transiently (402/429/5xx).
      // The job stays "uploaded" with no prediction id; the reconcile cron
      // (/api/blur/reconcile) re-kicks orphaned uploads, so it self-heals.
      console.error("blur pipeline trigger failed (will be reconciled):", err);
    }
  }

  return Response.json({
    jobId: job.id,
    status: blurConfigured ? "processing" : "uploaded",
  });
}
