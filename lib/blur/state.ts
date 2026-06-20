import { presignPrivateGet, uploadPrivate } from "@/lib/blob";
import {
  createPredictionWithRetry,
  DESIRED_REGIONS,
  IMAGE_DESIRED_REGIONS,
  NEGATIVE_REGIONS,
  GROUNDED_SAM_OUTPUT,
} from "./replicate";
import {
  compositeImageBlur,
  compositeImageBlurRegions,
  maskCoverage,
  fetchBuffer,
} from "./composite";
import { regionsToSam2Clicks } from "./geometry";
import { getJob, updateJob, addPredictionId, type BlurJob } from "./jobs";
import { SIGNED_URL_TTL, usingCog, webhookFields } from "./config";
import type { DetectedRegion, RegionPatch } from "@/lib/db/schema";
export { usingCog } from "./config";

// ════════════════════════════════════════════════════════════════════════════
// Entry point (called by ingest). Routes to the single Cog when it's configured
// (P5, Strategy B), else the multi-stage chain (P2).
// ════════════════════════════════════════════════════════════════════════════
/**
 * Single source of truth for (re)starting a job's pipeline from a persisted
 * `blur_jobs` row: presign the raw upload, then fire the first stage — the
 * single Cog when configured (P5), else the multi-stage chain (P2). Used by
 * upload (`/api/posts`, `/api/blur/ingest`), the reconcile cron (to recover a
 * job whose kickoff was lost), reject (re-run stronger), and manual retry.
 * `opts` escalates detection strength on a re-run; ignored on the Cog path.
 *
 * IMPORTANT: detectStage/cogStage flip the job to `detecting` and record the
 * prediction id ONLY after Replicate accepts the `create`. So if this throws
 * (a transient 402/429/5xx at create), the job stays `uploaded` with no
 * prediction id — the contract the reconcile cron relies on to re-kick it.
 */
export async function kickOff(
  job: Pick<BlurJob, "id" | "rawBlobKey" | "mediaType">,
  opts: DetectOpts = {},
) {
  const rawUrl = await presignPrivateGet(job.rawBlobKey, SIGNED_URL_TTL);
  return usingCog()
    ? cogStage(job.id, rawUrl, job.mediaType)
    : detectStage(job.id, rawUrl, job.mediaType, opts);
}

// P5 — one prediction does detect+track+composite on the GPU box.
async function cogStage(jobId: string, rawUrl: string, mediaType: "image" | "video") {
  const pred = await createPredictionWithRetry({
    version: process.env.REPLICATE_VEIL_AUTOBLUR_VERSION!,
    input: {
      media: rawUrl,
      media_type: mediaType,
      regions: DESIRED_REGIONS.join(","),
      box_threshold: Number(process.env.BLUR_BOX_THRESHOLD ?? 0.3),
      dilation: Number(process.env.BLUR_MASK_DILATION ?? 12),
      blur_strength: Number(process.env.BLUR_STRENGTH ?? 30),
      feather: Number(process.env.BLUR_FEATHER ?? 16),
    },
    ...webhookFields(jobId, "cog"),
  });
  await updateJob(jobId, { status: "detecting" });
  await addPredictionId(jobId, "cog", pred.id);
}

// ════════════════════════════════════════════════════════════════════════════
// Stage 1 — DETECT (multi-stage path). Starts a Replicate prediction with a
// webhook; never awaits completion.
// ════════════════════════════════════════════════════════════════════════════
export type DetectOpts = { dilation?: number; boxThreshold?: number };

export async function detectStage(
  jobId: string,
  rawUrl: string,
  mediaType: "image" | "video",
  opts: DetectOpts = {},
) {

  if (mediaType === "image") {
    const useBoxDetector =
      process.env.BLUR_IMAGE_BOX_DETECT !== "false" &&
      !!process.env.REPLICATE_GROUNDING_DINO_VERSION;
    const pred = useBoxDetector
      ? await createPredictionWithRetry({
          version: process.env.REPLICATE_GROUNDING_DINO_VERSION!,
          input: {
            image: rawUrl,
            query: IMAGE_DESIRED_REGIONS.join(". "),
            box_threshold:
              opts.boxThreshold ?? Number(process.env.BLUR_IMAGE_BOX_THRESHOLD ?? 0.22),
            text_threshold: Number(process.env.BLUR_IMAGE_TEXT_THRESHOLD ?? 0.2),
            show_visualisation: false,
          },
          ...webhookFields(jobId, "detect"),
        })
      : await createPredictionWithRetry({
          version: process.env.REPLICATE_GROUNDED_SAM_VERSION!,
          input: {
            image: rawUrl,
            mask_prompt: DESIRED_REGIONS.join(","),
            negative_mask_prompt: NEGATIVE_REGIONS.join(","),
            adjustment_factor:
              opts.dilation ?? Number(process.env.BLUR_MASK_DILATION ?? 12),
          },
          ...webhookFields(jobId, "detect"),
        });
    await updateJob(jobId, { status: "detecting" });
    await addPredictionId(jobId, "detect", pred.id);
    return;
  }

  // video: detect boxes on the first frame (seed @ frame 0).
  const { keyframeUrl, fps } = await extractFirstFrame(jobId, rawUrl);
  const pred = await createPredictionWithRetry({
    version: process.env.REPLICATE_GROUNDING_DINO_VERSION!,
    input: {
      image: keyframeUrl,
      query: DESIRED_REGIONS.join(","),
      box_threshold: opts.boxThreshold ?? Number(process.env.BLUR_BOX_THRESHOLD ?? 0.3),
      text_threshold: 0.25,
      show_visualisation: false,
    },
    ...webhookFields(jobId, "detect"),
  });
  await updateJob(jobId, { status: "detecting", sourceFps: Math.round(fps) });
  await addPredictionId(jobId, "detect", pred.id);
}

// ════════════════════════════════════════════════════════════════════════════
// advance() — called by the verified, deduped webhook receiver.
// ════════════════════════════════════════════════════════════════════════════
export async function advance(
  jobId: string,
  stage: string,
  payload: { output?: unknown; error?: string | null },
) {
  if (payload.error) {
    await updateJob(jobId, { status: "failed", error: String(payload.error) });
    return;
  }
  const job = await getJob(jobId);
  if (!job) return;

  if (stage === "cog") return onCogComplete(job, payload.output);
  if (stage === "detect") return onDetectComplete(job, payload.output);
  if (stage === "track") return onTrackComplete(job, payload.output);
}

// ── on Cog complete (P5) ────────────────────────────────────────────────────
// The Cog returns { media, detected_regions, max_confidence } — one shot.
async function onCogComplete(job: BlurJob, output: unknown) {
  const o = (output ?? {}) as {
    media?: string;
    detected_regions?: number;
    max_confidence?: number;
  };
  const conf = String(o.max_confidence ?? 0);

  // Fail-closed: nothing detected → manual review (the Cog still returns a
  // fully-blurred artifact, but we never auto-publish it).
  if (!o.media || !o.detected_regions) {
    await updateJob(job.id, { status: "manual_review", detectionConfidence: conf });
    return;
  }

  await updateJob(job.id, { status: "compositing" });
  const ext = job.mediaType === "video" ? "mp4" : "jpg";
  const blob = await uploadPrivate(`blur-jobs/${job.id}/blurred.${ext}`, await fetchBuffer(o.media), {
    contentType: job.mediaType === "video" ? "video/mp4" : "image/jpeg",
    upsert: true,
  });
  await updateJob(job.id, {
    status: "ready_for_review",
    blurredBlobUrl: blob.pathname,
    originalBlobKey: job.rawBlobKey,
    detectionConfidence: conf,
  });
}

// ── on detect complete ─────────────────────────────────────────────────────
async function onDetectComplete(job: BlurJob, output: unknown) {
  if (job.mediaType === "image") {
    const regions = detectedRegionsFromOutput(output);
    if (regions.length) {
      await compositeImageBoxStage(job, regions);
      return;
    }

    // Back-compat for already-running grounded_sam jobs:
    // grounded_sam → [annotated, neg, mask, inverted]; index 2 is the clean mask.
    const outputs = Array.isArray(output) ? (output as unknown[]).map(String) : [];
    const maskUrl = outputs[GROUNDED_SAM_OUTPUT.mask];
    if (!maskUrl) {
      await updateJob(job.id, { status: "manual_review", error: "api_no_output" });
      return;
    }
    const coverage = await maskCoverage(maskUrl);
    if (coverage < Number(process.env.BLUR_MIN_COVERAGE ?? 0.001)) {
      // Fail closed: nothing detected → never auto-publish.
      await updateJob(job.id, {
        status: "manual_review",
        detectionConfidence: String(coverage),
      });
      return;
    }
    await compositeImageStage(job, maskUrl, coverage);
    return;
  }

  // video: grounding-dino → boxes.
  const regions = detectedRegionsFromOutput(output);
  // box_threshold already filtered low-confidence boxes, so "no regions" = nothing found.
  if (!regions.length) {
    await updateJob(job.id, { status: "manual_review", detectionConfidence: "0" });
    return;
  }
  const maxConf = regions.reduce((m, r) => Math.max(m, r.confidence), 0);
  await updateJob(job.id, { regions, detectionConfidence: String(maxConf) });
  await trackStage(job, regions);
}

// ── Stage 2 — TRACK (video only) ────────────────────────────────────────────
async function trackStage(job: BlurJob, regions: DetectedRegion[]) {
  const rawUrl = await presignPrivateGet(job.rawBlobKey, SIGNED_URL_TTL);
  const pred = await createPredictionWithRetry({
    version: process.env.REPLICATE_SAM2_VIDEO_VERSION!,
    input: {
      input_video: rawUrl,
      ...regionsToSam2Clicks(regions),
      mask_type: "binary",
      output_video: true,
      video_fps: job.sourceFps ?? 30,
    },
    ...webhookFields(job.id, "track"),
  });
  await updateJob(job.id, { status: "tracking" });
  await addPredictionId(job.id, "track", pred.id);
}

// ── Stage 3 — COMPOSITE ───────────────────────────────────────────────────────
async function compositeImageStage(job: BlurJob, maskUrl: string, coverage: number) {
  await updateJob(job.id, { status: "compositing" });
  const rawUrl = await presignPrivateGet(job.rawBlobKey, SIGNED_URL_TTL);
  const blurred = await compositeImageBlur(rawUrl, maskUrl);
  const blob = await uploadPrivate(`blur-jobs/${job.id}/blurred.jpg`, blurred, {
    contentType: "image/jpeg",
    upsert: true,
  });
  await updateJob(job.id, {
    status: "ready_for_review",
    blurredBlobUrl: blob.pathname, // private/pending — published on approve (P3)
    originalBlobKey: job.rawBlobKey,
    detectionConfidence: String(coverage),
  });
}

async function compositeImageBoxStage(job: BlurJob, regions: DetectedRegion[]) {
  await updateJob(job.id, { status: "compositing" });
  const rawUrl = await presignPrivateGet(job.rawBlobKey, SIGNED_URL_TTL);
  const blurred = await compositeImageBlurRegions(rawUrl, regions);
  const blob = await uploadPrivate(`blur-jobs/${job.id}/blurred.jpg`, blurred, {
    contentType: "image/jpeg",
    upsert: true,
  });
  const maxConf = regions.reduce((m, r) => Math.max(m, r.confidence), 0);
  await updateJob(job.id, {
    status: "ready_for_review",
    blurredBlobUrl: blob.pathname,
    originalBlobKey: job.rawBlobKey,
    detectionConfidence: String(maxConf),
    regions,
  });
}

function detectedRegionsFromOutput(output: unknown): DetectedRegion[] {
  const det = (output ?? {}) as {
    detections?: Array<{ bbox: number[]; label?: string; confidence?: number }>;
  };
  return (det.detections ?? [])
    .filter((d) => Array.isArray(d.bbox) && d.bbox.length >= 4)
    .map((d) => ({
      label: d.label ?? "detected area",
      box: d.bbox.slice(0, 4) as [number, number, number, number],
      confidence: Number(d.confidence ?? 0),
      frame: 0,
    }));
}

async function onTrackComplete(job: BlurJob, output: unknown) {
  const outputs = Array.isArray(output) ? (output as unknown[]).map(String) : [String(output)];
  const maskVideoUrl = outputs[0];
  await updateJob(job.id, { status: "compositing" });

  // NOTE: ffmpeg compositing a full clip inside a function works for SHORT clips
  // but can exceed memory/time for long video — production moves this into the
  // Cog (P5) or a chunked worker (P4).
  const { compositeVideoBlur } = await import("./composite-video");
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const work = mkdtempSync(join(tmpdir(), "veil-composite-"));
  try {
    const srcPath = join(work, "src.mp4");
    const maskPath = join(work, "mask.mp4");
    const outPath = join(work, "blurred.mp4");
    const rawUrl = await presignPrivateGet(job.rawBlobKey, SIGNED_URL_TTL);
    writeFileSync(srcPath, await fetchBuffer(rawUrl));
    writeFileSync(maskPath, await fetchBuffer(maskVideoUrl));

    await compositeVideoBlur(srcPath, maskPath, outPath);

    const blob = await uploadPrivate(`blur-jobs/${job.id}/blurred.mp4`, readFileSync(outPath), {
      contentType: "video/mp4",
      upsert: true,
    });

    // Per-region clean crops for optional partial-reveal publishing. The clean
    // source is already on disk here. Non-fatal: if it fails, the post can still
    // be published as a normal full-gate post.
    let regionPatches: RegionPatch[] = [];
    try {
      regionPatches = await buildRegionPatches(job, srcPath, maskPath, work);
    } catch (e) {
      console.error("[blur] region crop failed (publishing full is still possible):", e);
    }

    await updateJob(job.id, {
      status: "ready_for_review",
      blurredBlobUrl: blob.pathname,
      originalBlobKey: job.rawBlobKey,
      regionPatches,
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Crop each detected region out of the clean source into its own clip. Detection
 * seeds boxes at frame 0; we pad generously so a region that drifts over a short
 * clip stays inside its crop. Crops are rectangular, so this assumes regions
 * don't overlap (true for the ~2-region clips we target) — otherwise one crop
 * could expose a neighbour. Returns [] when there's nothing to crop.
 */
async function buildRegionPatches(
  job: BlurJob,
  srcPath: string,
  maskPath: string,
  work: string,
): Promise<RegionPatch[]> {
  const regions = job.regions ?? [];
  if (!regions.length) return [];

  const { probeVideo } = await import("./frames");
  const { cropVideoRegion } = await import("./composite-video");
  const { clusterBoxes, padClampEven, toNormalizedRect } = await import("./geometry");
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");

  const meta = await probeVideo(srcPath);
  if (!meta.width || !meta.height) return [];

  const maxN = Number(process.env.BLUR_MAX_REGIONS ?? 6);
  const pad = Number(process.env.BLUR_REGION_PAD ?? 0.1);
  const maxArea = Number(process.env.BLUR_MAX_REGION_AREA ?? 0.35);
  const maxHeight = Number(process.env.BLUR_MAX_REGION_HEIGHT ?? 0.75);
  const maxWidth = Number(process.env.BLUR_MAX_REGION_WIDTH ?? 0.75);
  const clusters = clusterBoxes(regions, maxN);

  const patches: RegionPatch[] = [];
  for (let i = 0; i < clusters.length; i++) {
    const px = padClampEven(clusters[i].box, pad, meta.width, meta.height);
    if (px.w < 16 || px.h < 16) continue; // too small to bother
    const normalized = toNormalizedRect(px, meta.width, meta.height);
    if (
      normalized.w * normalized.h > maxArea ||
      normalized.h > maxHeight ||
      normalized.w > maxWidth
    ) {
      console.warn("[blur] skipping oversized partial region", {
        jobId: job.id,
        label: clusters[i].label,
        rect: normalized,
      });
      continue;
    }
    const out = join(work, `region-${i}.mp4`);
    await cropVideoRegion(srcPath, out, px);
    const blob = await uploadPrivate(
      `blur-jobs/${job.id}/region-${i}.mp4`,
      readFileSync(out),
      { contentType: "video/mp4", upsert: true },
    );
    patches.push({
      label: clusters[i].label,
      rect: normalized,
      patchKey: blob.pathname,
    });
  }

  // Per-frame position track per region so each tap-button follows its moving
  // blurred area. Pixels are attributed to a region by its union box. Non-fatal:
  // a missing track just falls back to the static rect in the player.
  if (patches.length > 0) {
    try {
      const { extractMaskTracks } = await import("./track-extract");
      const tracks = await extractMaskTracks(maskPath, patches.map((p) => p.rect));
      patches.forEach((p, i) => {
        if (tracks[i]?.length) p.track = tracks[i];
      });
    } catch (e) {
      console.error("[blur] mask track extraction failed (static rect used):", e);
    }
  }

  return patches;
}

// ── helpers ─────────────────────────────────────────────────────────────────
async function extractFirstFrame(
  jobId: string,
  videoUrl: string,
): Promise<{ keyframeUrl: string; fps: number }> {
  const { execFileSync } = await import("node:child_process");
  const ffmpeg = (await import("@ffmpeg-installer/ffmpeg")).default;
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { probeVideo } = await import("./frames");

  const work = mkdtempSync(join(tmpdir(), "veil-detect-"));
  try {
    const vid = join(work, "src.mp4");
    writeFileSync(vid, await fetchBuffer(videoUrl));
    const fps = (await probeVideo(vid)).fps;
    const frame = join(work, "kf.jpg");
    execFileSync(ffmpeg.path, ["-y", "-i", vid, "-vframes", "1", "-q:v", "2", frame], {
      stdio: "ignore",
    });
    const blob = await uploadPrivate(`blur-jobs/${jobId}/keyframe.jpg`, readFileSync(frame), {
      contentType: "image/jpeg",
      upsert: true,
    });
    return { keyframeUrl: await presignPrivateGet(blob.pathname, SIGNED_URL_TTL), fps };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
