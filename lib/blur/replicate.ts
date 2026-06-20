import Replicate from "replicate";

// Lazy singleton — never instantiate at module top-level in serverless.
let _client: Replicate | null = null;

export function getReplicate(): Replicate {
  if (!_client) {
    if (!process.env.REPLICATE_API_TOKEN) {
      throw new Error("REPLICATE_API_TOKEN is not set");
    }
    // useFileOutput: false → file outputs come back as plain URL strings
    // (not FileOutput stream objects), which is what the compositor fetches.
    _client = new Replicate({
      auth: process.env.REPLICATE_API_TOKEN,
      useFileOutput: false,
    });
  }
  return _client;
}

// Verified live against the Replicate API on 2026-06-18 (versions pinned in env).
export const MODELS = {
  // Text-prompted bounding-box detection (video keyframes — P1).
  groundingDino: {
    ref: `adirik/grounding-dino:${process.env.REPLICATE_GROUNDING_DINO_VERSION}` as const,
  },
  // Combined detect + mask, single call (IMAGES only — P0).
  groundedSam: {
    ref: `schananas/grounded_sam:${process.env.REPLICATE_GROUNDED_SAM_VERSION}` as const,
  },
  // Video segmentation/tracking — P1. NOT an official model: it requires a
  // pinned version hash (calling by name returns 422/404). Verified 2026-06-18.
  sam2Video: {
    ref: `meta/sam-2-video:${process.env.REPLICATE_SAM2_VIDEO_VERSION}` as const,
  },
  // Motion-aware tracker (fallback for fast motion) — P1/P4.
  samurai: {
    ref: `zsxkib/samurai:${process.env.REPLICATE_SAMURAI_VERSION}` as const,
  },
  // Strategy B (P5) — our single Cog: detect+track+composite in one call.
  // Only used when REPLICATE_VEIL_AUTOBLUR_VERSION is set (i.e. the Cog is pushed).
  veilAutoblur: {
    ref: `${process.env.REPLICATE_VEIL_AUTOBLUR_OWNER ?? "veil"}/veil-autoblur:${process.env.REPLICATE_VEIL_AUTOBLUR_VERSION}` as const,
  },
} as const;

// Replicate throttles prediction creation hard under low credit (6/min, burst
// of 1 while < $5). The video path fires two creates back-to-back (detect →
// track), so the second can 429. Retry on 429, waiting out the short window.
type CreateArgs = Parameters<Replicate["predictions"]["create"]>[0];

export async function createPredictionWithRetry(input: CreateArgs, attempts = 4) {
  const replicate = getReplicate();
  return withReplicateCreateRetry(() => replicate.predictions.create(input), attempts);
}

export async function withReplicateCreateRetry<T>(
  create: () => Promise<T>,
  attempts = 4,
): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await create();
    } catch (err) {
      const status =
        (err as { response?: { status?: number } })?.response?.status ??
        (err as { status?: number })?.status;
      const message = String((err as Error)?.message);
      const is429 = status === 429 || /\b429\b/.test(message);
      if (!is429 || i >= attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, retryDelayMs(err)));
    }
  }
}

function retryDelayMs(err: unknown): number {
  const retryAfter =
    (err as { response?: { headers?: { get?: (name: string) => string | null } } })?.response
      ?.headers?.get?.("retry-after") ??
    (err as { retry_after?: string | number })?.retry_after ??
    String((err as Error)?.message).match(/retry[_ -]?after["': ]+(\d+)/i)?.[1];
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) return Math.max(1_000, seconds * 1_000);
  return 12_000; // 6/min low-credit window refills roughly every 10 seconds.
}

// Region prompt taxonomy for explicit/sexual exposure. Use concrete anatomy and
// common synonyms so Grounding DINO has several chances to bind the correct
// visual concept, while the downstream size guards reject broad person/body
// boxes before they become partial-unlock regions. Comma-joined for
// grounded_sam's `mask_prompt` and grounding-dino's `query`.
export const DESIRED_REGIONS = [
  "breast",
  "breasts",
  "nipple",
  "nipples",
  "areola",
  "areolas",
  "bare chest",
  "bare male chest",
  "shirtless chest",
  "shirtless male chest",
  "bare torso",
  "bare male torso",
  "shirtless torso",
  "shirtless male torso",
  "abdomen",
  "abs",
  "penis",
  "erect penis",
  "testicles",
  "scrotum",
  "vagina",
  "vulva",
  "labia",
  "pubic area",
  "genitals",
  "genital area",
  "crotch",
  "anus",
  "anal area",
  "buttocks",
  "bare buttocks",
  "sex toy",
  "dildo",
  "vibrator",
];

export const IMAGE_DESIRED_REGIONS = [
  "shirtless man",
  "shirtless male",
  "shirtless upper body",
  "bare upper body",
  "bare male upper body",
  "bare chest",
  "bare male chest",
  "shirtless chest",
  "shirtless male chest",
  "bare torso",
  "bare male torso",
  "shirtless torso",
  "shirtless male torso",
  "male torso",
  "abdomen",
  "abdominal muscles",
  "abs",
  ...DESIRED_REGIONS,
];

// Regions we never want to blur, even if they overlap a positive match.
export const NEGATIVE_REGIONS = ["face", "clothing", "background"];

// grounded_sam returns a 4-element iterator in a FIXED order. Verified against
// the model's default_example on 2026-06-18:
//   [0] annotated_picture_mask  [1] neg_annotated_picture_mask
//   [2] mask (clean B&W)        [3] inverted_mask
// We composite with [2] — NOT [0], which is the annotated overlay.
export const GROUNDED_SAM_OUTPUT = {
  annotated: 0,
  negAnnotated: 1,
  mask: 2,
  invertedMask: 3,
} as const;
