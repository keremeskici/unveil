/**
 * DEV ONLY — publish /Users/kerem/Downloads/videooo.mp4 as a two-region partial
 * video post. Regions:
 *   - chest: active while the athlete faces camera
 *   - buttocks: active after he turns around
 *
 * Usage:
 *   dotenv -e .env.local -- tsx scripts/dev-post-videooo.ts
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { uploadPrivate } from "@/lib/blob";
import { compositeVideoBlur, cropVideoRegion } from "@/lib/blur/composite-video";
import { probeVideo } from "@/lib/blur/frames";
import { getDb } from "@/lib/db";
import {
  posts,
  postRegions,
  users,
  type RegionRect,
  type RegionTrackPoint,
} from "@/lib/db/schema";

const SOURCE_PATH = "/Users/kerem/Downloads/videooo.mp4";
const POST_ID = "8f4da1ef-7d86-49b8-bf08-95df65b9aa01";
const STORAGE_PREFIX = `blur-jobs/manual-${POST_ID}`;
const SOURCE_KEY = `${STORAGE_PREFIX}/original.mp4`;
const BLURRED_KEY = `${STORAGE_PREFIX}/blurred.mp4`;
const POSTER_KEY = `${STORAGE_PREFIX}/poster.jpg`;
const SAMPLE_FPS = 10;
const CROP_PAD = 0.06;
const MASK_SOLID_STOP = 0.76;
const MASK_FADE_STOP = 1;
const MASK_FEATHER_SIGMA = 24;
const CREATOR_WALLET = "0x5151515151515151515151515151515151515151";
const INACTIVE: RegionRect = { x: 0.5, y: 0.5, w: 0.001, h: 0.001 };

type RegionLabel = "chest" | "buttocks";
type Keyframe = { t: number; rect: RegionRect };
type ManualRegion = { label: RegionLabel; keyframes: Keyframe[] };

const MANUAL_REGIONS: ManualRegion[] = [
  {
    label: "chest",
    keyframes: [
      { t: 0, rect: { x: 0.438, y: 0.22, w: 0.22, h: 0.175 } },
      { t: 1, rect: { x: 0.438, y: 0.22, w: 0.22, h: 0.175 } },
      { t: 2, rect: { x: 0.44, y: 0.221, w: 0.218, h: 0.174 } },
      { t: 3, rect: { x: 0.442, y: 0.222, w: 0.216, h: 0.172 } },
      { t: 4, rect: { x: 0.442, y: 0.224, w: 0.214, h: 0.17 } },
      { t: 4.7, rect: { x: 0.45, y: 0.228, w: 0.195, h: 0.155 } },
      { t: 5.5, rect: { x: 0.468, y: 0.214, w: 0.16, h: 0.19 } },
      { t: 5.8, rect: INACTIVE },
      { t: 14.692, rect: INACTIVE },
    ],
  },
  {
    label: "buttocks",
    keyframes: [
      { t: 0, rect: { x: 0.445, y: 0.43, w: 0.155, h: 0.22 } },
      { t: 1, rect: { x: 0.445, y: 0.43, w: 0.155, h: 0.22 } },
      { t: 2, rect: { x: 0.445, y: 0.43, w: 0.155, h: 0.22 } },
      { t: 3, rect: { x: 0.446, y: 0.43, w: 0.153, h: 0.218 } },
      { t: 4.7, rect: { x: 0.45, y: 0.428, w: 0.152, h: 0.22 } },
      { t: 5.4, rect: { x: 0.482, y: 0.395, w: 0.155, h: 0.275 } },
      { t: 6.2, rect: { x: 0.37, y: 0.372, w: 0.285, h: 0.36 } },
      { t: 8, rect: { x: 0.365, y: 0.365, w: 0.285, h: 0.365 } },
      { t: 10, rect: { x: 0.37, y: 0.372, w: 0.275, h: 0.35 } },
      { t: 12, rect: { x: 0.375, y: 0.376, w: 0.265, h: 0.34 } },
      { t: 14.692, rect: { x: 0.372, y: 0.372, w: 0.275, h: 0.35 } },
    ],
  },
];

function roundRect(rect: RegionRect): RegionRect {
  return {
    x: round(rect.x),
    y: round(rect.y),
    w: round(rect.w),
    h: round(rect.h),
  };
}

function round(n: number) {
  return Number(n.toFixed(6));
}

function clamp01(v: number, offset = 0) {
  return Math.max(0, Math.min(1 - offset, v));
}

function isInactiveRect(rect: RegionRect) {
  return rect.w < 0.01 || rect.h < 0.01;
}

function sampleKeyframes(keyframes: Keyframe[], t: number): RegionRect {
  if (t <= keyframes[0].t) return keyframes[0].rect;
  const last = keyframes[keyframes.length - 1];
  if (t >= last.t) return last.rect;

  let i = 1;
  while (i < keyframes.length && keyframes[i].t < t) i += 1;
  const a = keyframes[i - 1];
  const b = keyframes[i];
  if (isInactiveRect(a.rect) !== isInactiveRect(b.rect)) {
    return t >= b.t ? b.rect : a.rect;
  }
  const f = (t - a.t) / (b.t - a.t || 1);
  return roundRect({
    x: a.rect.x + (b.rect.x - a.rect.x) * f,
    y: a.rect.y + (b.rect.y - a.rect.y) * f,
    w: a.rect.w + (b.rect.w - a.rect.w) * f,
    h: a.rect.h + (b.rect.h - a.rect.h) * f,
  });
}

function buildTrack(region: ManualRegion, durationSec: number): RegionTrackPoint[] {
  const samples = Math.ceil(durationSec * SAMPLE_FPS) + 1;
  const track: RegionTrackPoint[] = [];
  for (let i = 0; i < samples; i += 1) {
    const t = Math.min(durationSec, i / SAMPLE_FPS);
    track.push({ t: round(t), rect: sampleKeyframes(region.keyframes, t) });
  }
  return track;
}

function unionTrack(track: RegionTrackPoint[], pad = 0): RegionRect {
  let x0 = 1;
  let y0 = 1;
  let x1 = 0;
  let y1 = 0;
  for (const point of track) {
    if (point.rect.w < 0.01 || point.rect.h < 0.01) continue;
    x0 = Math.min(x0, point.rect.x);
    y0 = Math.min(y0, point.rect.y);
    x1 = Math.max(x1, point.rect.x + point.rect.w);
    y1 = Math.max(y1, point.rect.y + point.rect.h);
  }
  if (x1 <= x0 || y1 <= y0) return { ...INACTIVE };
  const x = clamp01(x0 - pad);
  const y = clamp01(y0 - pad);
  return roundRect({
    x,
    y,
    w: clamp01(x1 - x0 + pad * 2, x),
    h: clamp01(y1 - y0 + pad * 2, y),
  });
}

function toEvenPixelRect(rect: RegionRect, srcW: number, srcH: number) {
  const x = evenFloor(rect.x * srcW);
  const y = evenFloor(rect.y * srcH);
  const right = evenCeil((rect.x + rect.w) * srcW);
  const bottom = evenCeil((rect.y + rect.h) * srcH);
  return {
    x,
    y,
    w: Math.max(2, Math.min(srcW - x, right - x)),
    h: Math.max(2, Math.min(srcH - y, bottom - y)),
  };
}

function toNormalizedRect(
  rect: { x: number; y: number; w: number; h: number },
  srcW: number,
  srcH: number,
): RegionRect {
  return roundRect({
    x: rect.x / srcW,
    y: rect.y / srcH,
    w: rect.w / srcW,
    h: rect.h / srcH,
  });
}

function evenFloor(n: number) {
  return Math.max(0, Math.floor(n / 2) * 2);
}

function evenCeil(n: number) {
  return Math.ceil(n / 2) * 2;
}

async function renderMaskFrames({
  dir,
  width,
  height,
  tracks,
}: {
  dir: string;
  width: number;
  height: number;
  tracks: RegionTrackPoint[][];
}) {
  const frames = Math.max(...tracks.map((track) => track.length));
  for (let i = 0; i < frames; i += 1) {
    let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs>`;
    for (let t = 0; t < tracks.length; t += 1) {
      svg += `<radialGradient id="soft-${t}" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="white" stop-opacity="1"/><stop offset="${MASK_SOLID_STOP * 100}%" stop-color="white" stop-opacity="1"/><stop offset="${MASK_FADE_STOP * 100}%" stop-color="white" stop-opacity="0"/></radialGradient>`;
    }
    svg += "</defs>";
    for (let t = 0; t < tracks.length; t += 1) {
      const track = tracks[t];
      const rect = track[Math.min(i, track.length - 1)].rect;
      svg += `<ellipse cx="${(rect.x + rect.w / 2) * width}" cy="${(rect.y + rect.h / 2) * height}" rx="${(rect.w * width) / 2}" ry="${(rect.h * height) / 2}" fill="url(#soft-${t})"/>`;
    }
    svg += "</svg>";
    await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: "black",
      },
    })
      .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
      .png()
      .toFile(join(dir, `mask-${String(i + 1).padStart(4, "0")}.png`));
  }
}

function encodeMaskVideo(frameDir: string, outPath: string, durationSec: number) {
  execFileSync(
    ffmpegInstaller.path,
    [
      "-y",
      "-framerate",
      String(SAMPLE_FPS),
      "-i",
      join(frameDir, "mask-%04d.png"),
      "-t",
      String(durationSec),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      outPath,
    ],
    { stdio: "inherit" },
  );
}

function extractPoster(videoPath: string, outPath: string) {
  execFileSync(
    ffmpegInstaller.path,
    ["-y", "-ss", "1", "-i", videoPath, "-frames:v", "1", "-q:v", "3", outPath],
    { stdio: "ignore" },
  );
}

async function main() {
  if (!existsSync(SOURCE_PATH)) throw new Error(`source does not exist: ${SOURCE_PATH}`);

  const db = getDb();
  const workDir = resolve(`/tmp/veil-videooo-post`);
  rmSync(join(workDir, "generated"), { recursive: true, force: true });
  mkdirSync(join(workDir, "generated"), { recursive: true });

  const sourcePath = SOURCE_PATH;
  const meta = await probeVideo(sourcePath);
  if (!meta.width || !meta.height || !meta.durationSec) {
    throw new Error("source video is missing width/height/duration metadata");
  }

  const tracksByLabel = new Map<RegionLabel, RegionTrackPoint[]>();
  const rectsByLabel = new Map<RegionLabel, RegionRect>();
  const pixelRectsByLabel = new Map<RegionLabel, { x: number; y: number; w: number; h: number }>();
  for (const region of MANUAL_REGIONS) {
    const track = buildTrack(region, meta.durationSec);
    const pixelRect = toEvenPixelRect(unionTrack(track, CROP_PAD), meta.width, meta.height);
    tracksByLabel.set(region.label, track);
    rectsByLabel.set(region.label, toNormalizedRect(pixelRect, meta.width, meta.height));
    pixelRectsByLabel.set(region.label, pixelRect);
  }

  const frameDir = join(workDir, "generated", "mask-frames");
  mkdirSync(frameDir, { recursive: true });
  await renderMaskFrames({
    dir: frameDir,
    width: meta.width,
    height: meta.height,
    tracks: MANUAL_REGIONS.map((region) => tracksByLabel.get(region.label)!),
  });

  const maskPath = join(workDir, "generated", "mask.mp4");
  const blurredPath = join(workDir, "generated", "blurred.mp4");
  const posterPath = join(workDir, "generated", "poster.jpg");
  encodeMaskVideo(frameDir, maskPath, meta.durationSec);
  await compositeVideoBlur(sourcePath, maskPath, blurredPath, {
    featherSigma: MASK_FEATHER_SIGMA,
  });
  extractPoster(blurredPath, posterPath);

  await uploadPrivate(SOURCE_KEY, readFileSync(sourcePath), {
    contentType: "video/mp4",
    upsert: true,
  });
  await uploadPrivate(BLURRED_KEY, readFileSync(blurredPath), {
    contentType: "video/mp4",
    upsert: true,
  });
  await uploadPrivate(POSTER_KEY, readFileSync(posterPath), {
    contentType: "image/jpeg",
    upsert: true,
  });

  const [creator] = await db
    .insert(users)
    .values({
      walletAddress: CREATOR_WALLET,
      username: "olympia_stage",
      displayName: "Olympia Stage",
      isCreator: true,
    })
    .onConflictDoUpdate({
      target: users.walletAddress,
      set: {
        username: "olympia_stage",
        displayName: "Olympia Stage",
        isCreator: true,
      },
    })
    .returning();

  await db
    .insert(posts)
    .values({
      id: POST_ID,
      creatorId: creator.id,
      title: "Stage physique",
      blurredPreviewUrl: BLURRED_KEY,
      privateMediaKey: SOURCE_KEY,
      posterKey: POSTER_KEY,
      unlockPrice: "0.50",
      mediaType: "video",
      accessMode: "partial",
      durationMs: Math.round(meta.durationSec * 1000),
      isPublished: true,
      createdAt: new Date(),
    })
    .onConflictDoUpdate({
      target: posts.id,
      set: {
        creatorId: creator.id,
        title: "Stage physique",
        blurredPreviewUrl: BLURRED_KEY,
        privateMediaKey: SOURCE_KEY,
        posterKey: POSTER_KEY,
        unlockPrice: "0.50",
        mediaType: "video",
        accessMode: "partial",
        durationMs: Math.round(meta.durationSec * 1000),
        isPublished: true,
        createdAt: new Date(),
      },
    });

  await db.delete(postRegions).where(eq(postRegions.postId, POST_ID));
  for (let i = 0; i < MANUAL_REGIONS.length; i += 1) {
    const region = MANUAL_REGIONS[i];
    const patchPath = join(workDir, "generated", `${region.label}.mp4`);
    const patchKey = `${STORAGE_PREFIX}/region-${i}-${region.label}.mp4`;
    await cropVideoRegion(sourcePath, patchPath, pixelRectsByLabel.get(region.label)!);
    await uploadPrivate(patchKey, readFileSync(patchPath), {
      contentType: "video/mp4",
      upsert: true,
    });
    await db.insert(postRegions).values({
      postId: POST_ID,
      label: region.label,
      rect: rectsByLabel.get(region.label)!,
      track: tracksByLabel.get(region.label)!,
      patchMediaKey: patchKey,
      position: i,
    });
  }

  console.log(
    JSON.stringify(
      {
        postId: POST_ID,
        creator: creator.username,
        sourcePath,
        workDir,
        blurredKey: BLURRED_KEY,
        posterKey: POSTER_KEY,
        regions: MANUAL_REGIONS.map((region) => ({
          label: region.label,
          rect: rectsByLabel.get(region.label),
          trackPoints: tracksByLabel.get(region.label)?.length ?? 0,
        })),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
