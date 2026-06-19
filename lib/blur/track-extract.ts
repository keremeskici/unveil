import type { RegionRect, RegionTrackPoint } from "@/lib/db/schema";

// Sampling rate for the position track. SAM2 gives a per-frame mask; we don't
// need every frame to make the button follow smoothly — the player interpolates
// between samples — so we resample to keep the stored track small.
const SAMPLE_FPS = 10;
const MAX_SAMPLES = 120; // cap stored points (≈12s); longer clips clamp at the end
const FRAME_W = 192; // downscaled mask width for the bbox scan
const WHITE = 128; // mask pixel >= this counts as "inside the region"
const PAD = 0.06; // expand each box a touch so the button covers the feathered edge

/**
 * Turn a SAM2 binary mask video into per-region position tracks: for each
 * sampled frame, the bounding box of the white (masked) pixels, normalized to
 * the frame so it scales to any player size. This is what lets each tap-button
 * follow its moving blurred area instead of sitting on a static box.
 *
 * `clips` are the regions' union boxes (normalized 0..1). The combined mask
 * can't be split per-object, so we attribute white pixels to a region by which
 * union box they fall in — correct for the distinct body areas we target. One
 * track is returned per clip (same order); a clip with no mask pixels in a frame
 * simply has no sample there. Returns [] tracks on an unreadable/empty mask so
 * the caller falls back to the static rect.
 */
export async function extractMaskTracks(
  maskPath: string,
  clips: RegionRect[],
): Promise<RegionTrackPoint[][]> {
  if (clips.length === 0) return [];
  const { execFileSync } = await import("node:child_process");
  const ffmpeg = (await import("@ffmpeg-installer/ffmpeg")).default;
  const { mkdtempSync, readdirSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const sharp = (await import("sharp")).default;

  const dir = mkdtempSync(join(tmpdir(), "veil-track-"));
  try {
    // Downscaled grayscale frames at SAMPLE_FPS — bbox precision survives the
    // shrink and the scan stays cheap. Extract once, scan per clip.
    execFileSync(
      ffmpeg.path,
      [
        "-y",
        "-i", maskPath,
        "-vf", `fps=${SAMPLE_FPS},scale=${FRAME_W}:-2,format=gray`,
        "-frames:v", String(MAX_SAMPLES),
        join(dir, "m_%04d.png"),
      ],
      { stdio: "ignore" },
    );

    const frames = readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
    const tracks: RegionTrackPoint[][] = clips.map(() => []);

    for (let i = 0; i < frames.length; i++) {
      const { data, info } = await sharp(join(dir, frames[i]))
        .toColourspace("b-w")
        .raw()
        .toBuffer({ resolveWithObject: true });
      const t = i / SAMPLE_FPS;
      for (let c = 0; c < clips.length; c++) {
        const rect = boundingRectIn(data, info.width, info.height, clips[c]);
        if (rect) tracks[c].push({ t, rect });
      }
    }
    return tracks;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Normalized bbox of pixels >= WHITE that fall inside `clip` (normalized 0..1),
 * padded + clamped to the frame. Null if the clip holds no mask pixels.
 */
function boundingRectIn(
  data: Buffer,
  w: number,
  h: number,
  clip: RegionRect,
): RegionRect | null {
  const x0 = Math.max(0, Math.floor(clip.x * w));
  const y0 = Math.max(0, Math.floor(clip.y * h));
  const x1 = Math.min(w, Math.ceil((clip.x + clip.w) * w));
  const y1 = Math.min(h, Math.ceil((clip.y + clip.h) * h));

  let minX = x1, minY = y1, maxX = -1, maxY = -1;
  for (let y = y0; y < y1; y++) {
    const row = y * w;
    for (let x = x0; x < x1; x++) {
      if (data[row + x] >= WHITE) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;

  // +1 so the box is inclusive of the last pixel, then pad and clamp to 0..1.
  const bw = (maxX - minX + 1) / w;
  const bh = (maxY - minY + 1) / h;
  const px = bw * PAD;
  const py = bh * PAD;
  const x = clamp01(minX / w - px);
  const y = clamp01(minY / h - py);
  return {
    x,
    y,
    w: clamp01(bw + px * 2, x),
    h: clamp01(bh + py * 2, y),
  };
}

function clamp01(v: number, offset = 0): number {
  return Math.max(0, Math.min(1 - offset, v));
}
