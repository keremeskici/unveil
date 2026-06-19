import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import type { BlurOptions } from "./composite";

// Split from composite.ts so the image path (sharp only) never loads ffmpeg.
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

/**
 * Composite a blurred region into a video using the SAM2 mask track, preserving
 * the original audio.
 *
 *   [0] = original clip (video + audio)   [1] = B&W mask video
 *
 * Filtergraph:
 *   - blur a full copy of the source
 *   - feather the mask (gblur) so the edge fades, then use it as alpha
 *   - overlay the masked-blur back over the sharp original
 *
 * Audio: `-map 0:a? -c:a copy` keeps the original track if present (the `?`
 * makes it optional, so silent clips don't fail). `+faststart` for web playback.
 */
export function compositeVideoBlur(
  originalPath: string,
  maskVideoPath: string,
  outPath: string,
  opts: BlurOptions = {},
): Promise<void> {
  const blur = Math.max(1, Math.round(opts.blurSigma ?? Number(process.env.BLUR_STRENGTH ?? 30)));
  const feather = opts.featherSigma ?? Number(process.env.BLUR_FEATHER ?? 16);

  // gblur sigma must be > 0; skip the feather filter for a hard edge.
  const maskChain =
    feather >= 0.3
      ? `[1:v]format=gray,gblur=sigma=${feather}[mask]`
      : `[1:v]format=gray[mask]`;

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(originalPath) // [0] video + audio
      .input(maskVideoPath) // [1] mask
      .complexFilter([
        `[0:v]boxblur=${blur}:2[blurred]`,
        maskChain,
        `[blurred][mask]alphamerge[fg]`,
        `[0:v][fg]overlay=format=auto[outv]`,
      ])
      .outputOptions([
        "-map",
        "[outv]",
        "-map",
        "0:a?", // copy original audio if present
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
        "-pix_fmt",
        "yuv420p",
      ])
      .save(outPath)
      .on("end", () => resolve())
      .on("error", reject);
  });
}

/**
 * Crop the CLEAN source to a region rect → a small standalone clip used as a
 * partial-reveal patch. Audio is dropped (the blurred base carries it). Output
 * is web-safe H.264/yuv420p + faststart. `rect` must already be even-snapped
 * (see padClampEven) — yuv420p rejects odd crop dimensions.
 */
export function cropVideoRegion(
  srcPath: string,
  outPath: string,
  rect: { x: number; y: number; w: number; h: number },
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(srcPath)
      .videoFilters(`crop=${rect.w}:${rect.h}:${rect.x}:${rect.y}`)
      .outputOptions([
        "-an", // the base clip owns the audio
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
      ])
      .save(outPath)
      .on("end", () => resolve())
      .on("error", reject);
  });
}
