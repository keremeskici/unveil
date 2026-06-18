# IMPLEMENTATION.md — Auto-Blur Pipeline

> The code-grounded build plan for the auto-blur feature specified in [PRD.md](./PRD.md).
> Branch: `feature/auto-blur-pipeline`. Provider: **Replicate** (hosted-only).
>
> Read the PRD first for the *what* and *why*. This document is the *how* — file
> layout, exact Replicate calls, ffmpeg commands, the job state machine, webhook
> handling, and a phase-by-phase build order with time estimates.

---

## Table of Contents

1. [Prerequisites & Setup](#1-prerequisites--setup)
2. [Module File Layout](#2-module-file-layout)
3. [Environment Variables](#3-environment-variables)
4. [Data Model (Drizzle)](#4-data-model-drizzle)
5. [The Replicate Client & Model Registry](#5-the-replicate-client--model-registry)
6. [Phase P0 — Image Pipeline (PoC)](#6-phase-p0--image-pipeline-poc)
7. [Phase P1 — Video Pipeline (PoC)](#7-phase-p1--video-pipeline-poc)
8. [Phase P2 — Async Orchestration + State Machine](#8-phase-p2--async-orchestration--state-machine)
9. [Phase P3 — Creator Review Gate](#9-phase-p3--creator-review-gate)
10. [Phase P4 — Production Hardening](#10-phase-p4--production-hardening)
11. [Phase P5 — Single Cog Pipeline (Strategy B)](#11-phase-p5--single-cog-pipeline-strategy-b)
12. [Testing & Verification](#12-testing--verification)
13. [Build Order & Time Budget](#13-build-order--time-budget)
14. [Pitfall → Code Mitigation Map](#14-pitfall--code-mitigation-map)

---

## 1. Prerequisites & Setup

```bash
# On the feature branch
git branch --show-current   # → feature/auto-blur-pipeline

# Install deps
npm install replicate            # Replicate SDK (server-side only)
npm install svix                 # webhook signature verification (Replicate uses svix-style)
# ffmpeg: for Strategy A compositing. On Vercel use a static binary package:
npm install @ffmpeg-installer/ffmpeg fluent-ffmpeg
npm install -D @types/fluent-ffmpeg
```

**Account setup (one-time, manual):**
1. Create a Replicate account, generate an API token → `REPLICATE_API_TOKEN`.
2. Fetch the default webhook signing secret (used to verify callbacks):
   ```bash
   curl -s -H "Authorization: Bearer $REPLICATE_API_TOKEN" \
     https://api.replicate.com/v1/webhooks/default/secret
   # → { "key": "whsec_..." }  → store as REPLICATE_WEBHOOK_SECRET
   ```
3. **Pin model versions.** Community models (`grounding-dino`, `grounded_sam`, `samurai`) require an exact version hash for reproducibility. Fetch and record them:
   ```bash
   curl -s -H "Authorization: Bearer $REPLICATE_API_TOKEN" \
     https://api.replicate.com/v1/models/adirik/grounding-dino \
     | jq -r '.latest_version.id'
   ```
   Official models (`meta/sam-2-video`) can be called by name. See §5.

---

## 2. Module File Layout

All auto-blur code is namespaced so it stays isolated and easy to lift into the parent app or a separate service later.

```
auto-blur/
  PRD.md                          ← spec (done)
  IMPLEMENTATION.md               ← this file
  cog/                            ← Strategy B (P5) — custom Replicate model
    cog.yaml
    predict.py
    README.md

lib/blur/
  replicate.ts                    ← Replicate client singleton + MODELS registry
  pipeline-image.ts               ← image: detect+mask → composite
  pipeline-video.ts               ← video: keyframe detect → track → composite
  detect.ts                       ← grounding-dino / grounded_sam wrappers
  track.ts                        ← sam-2-video / samurai wrappers
  composite.ts                    ← ffmpeg blur compositing (Strategy A)
  geometry.ts                     ← box → SAM2 click-point conversion
  state.ts                        ← job state machine transitions
  jobs.ts                         ← blur_jobs DB queries (Drizzle)
  webhook.ts                      ← signature verification + event routing

app/api/blur/
  ingest/route.ts                 ← POST: start a job, fire-and-return
  webhook/route.ts                ← POST: Replicate callback (verified, idempotent)
  jobs/[id]/route.ts              ← GET: poll status
  jobs/[id]/approve/route.ts      ← POST: creator approves → publish
  jobs/[id]/reject/route.ts       ← POST: creator rejects → re-run / manual

app/(creator)/blur-review/[id]/page.tsx   ← review UI (P3)
components/blur/
  ReviewPanel.tsx                 ← side-by-side preview + region overlay
  RegionOverlay.tsx               ← draws detected boxes on the preview
  ManualMaskCanvas.tsx            ← click-to-seed points for re-run (P3)
```

---

## 3. Environment Variables

Add to `.env.local` and Vercel project settings. **All server-only — never `NEXT_PUBLIC_`.**

```env
# Replicate
REPLICATE_API_TOKEN=r8_...
REPLICATE_WEBHOOK_SECRET=whsec_...

# Pinned model versions (community models)
REPLICATE_GROUNDING_DINO_VERSION=<hash>
REPLICATE_GROUNDED_SAM_VERSION=<hash>
REPLICATE_SAMURAI_VERSION=<hash>
# meta/sam-2-video is an official model → called by name, no hash needed

# Public base URL so Replicate can call our webhook
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app

# Tuning (overridable per-request)
BLUR_KEYFRAME_FPS=1                 # detection sampling rate
BLUR_BOX_THRESHOLD=0.3              # grounding-dino confidence
BLUR_MASK_DILATION=12               # px to expand mask (anti-leakage)
BLUR_MIN_CONFIDENCE=0.45            # below this → manual_review (fail closed)
```

---

## 4. Data Model (Drizzle)

Add to the existing `lib/db/schema.ts` (parent app). Mirrors PRD §9.

```ts
import { pgTable, uuid, varchar, text, numeric, integer, jsonb, timestamp, pgEnum } from 'drizzle-orm/pg-core'
import { users, posts } from './schema'  // existing tables

export const blurStatusEnum = pgEnum('blur_status', [
  'uploaded',
  'detecting',
  'tracking',
  'compositing',
  'ready_for_review',
  'approved',
  'published',
  'failed',
  'manual_review',
])

export const blurMediaTypeEnum = pgEnum('blur_media_type', ['image', 'video'])

export const blurJobs = pgTable('blur_jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  postId: uuid('post_id').references(() => posts.id, { onDelete: 'set null' }),
  creatorId: uuid('creator_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  mediaType: blurMediaTypeEnum('media_type').notNull(),
  status: blurStatusEnum('status').notNull().default('uploaded'),

  rawBlobKey: text('raw_blob_key').notNull(),       // private — the upload
  blurredBlobUrl: text('blurred_blob_url'),          // public — set on success
  originalBlobKey: text('original_blob_key'),        // private — set on success

  // One Replicate prediction id per stage, e.g. { detect: "...", track: "...", composite: "..." }
  predictionIds: jsonb('prediction_ids').$type<Record<string, string>>().default({}),
  detectionConfidence: numeric('detection_confidence'),  // drives fail-closed routing
  regions: jsonb('regions').$type<DetectedRegion[]>().default([]),  // for review overlay

  error: text('error'),
  attempts: integer('attempts').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// Shared type for detected regions
export type DetectedRegion = {
  label: string
  box: [number, number, number, number]   // [x1, y1, x2, y2]
  confidence: number
  frame?: number                            // video only
}
```

Push with the parent's command (no migration files for now):
```bash
npm run db:push     # dotenv -e .env.local -- drizzle-kit push
```

---

## 5. The Replicate Client & Model Registry

`lib/blur/replicate.ts` — one client, one place that names every model.

```ts
import Replicate from 'replicate'

// Lazy singleton — never instantiate at module top-level in serverless
let _client: Replicate | null = null
export function getReplicate() {
  if (!_client) {
    _client = new Replicate({ auth: process.env.REPLICATE_API_TOKEN! })
  }
  return _client
}

// Verified models (confirmed live against the Replicate API, 2026-06-18).
export const MODELS = {
  // Text-prompted bounding-box detection
  groundingDino: {
    ref: `adirik/grounding-dino:${process.env.REPLICATE_GROUNDING_DINO_VERSION}` as const,
  },
  // Combined detect + mask, single call (IMAGES only)
  groundedSam: {
    ref: `schananas/grounded_sam:${process.env.REPLICATE_GROUNDED_SAM_VERSION}` as const,
  },
  // Official video segmentation/tracking — call by name (no version hash)
  sam2Video: { owner: 'meta', name: 'sam-2-video' } as const,
  // Motion-aware tracker (fallback for fast motion)
  samurai: {
    ref: `zsxkib/samurai:${process.env.REPLICATE_SAMURAI_VERSION}` as const,
  },
  // Cheap NSFW pre-gate (whole-frame classification, no boxes)
  nsfwImage: { owner: 'falcons-ai', name: 'nsfw_image_detection' } as const,
  nsfwVideo: { ref: 'lucataco/nsfw_video_detection' as const },
} as const

// Region prompt taxonomy — TUNE empirically (PRD open question #1).
// Comma-separated for grounding-dino's `query`; comma-joined for grounded_sam's `mask_prompt`.
export const DESIRED_REGIONS = ['breast', 'genitalia', 'buttocks', 'nipple']
```

**Calling conventions (verified):**
- Community model (has version): `replicate.predictions.create({ version, input, webhook, webhook_events_filter: ['completed'] })`.
- Official model (by name): `replicate.models.predictions.create({ model_owner, model_name, input, webhook, webhook_events_filter: ['completed'] })`.
- Synchronous helper (short jobs, ≤60s): `replicate.run(ref, { input })` — blocks; use only for images in P0.

---

## 6. Phase P0 — Image Pipeline (PoC)

**Goal:** one image → blurred + original derivatives. Validates prompts, thresholds, dilation. Synchronous is fine here (images are fast).

`lib/blur/pipeline-image.ts`:

```ts
import { getReplicate, MODELS, DESIRED_REGIONS } from './replicate'
import { compositeImageBlur } from './composite'

export async function processImage(rawImageUrl: string) {
  const replicate = getReplicate()

  // 1. Detect + mask in one call (grounded_sam). adjustment_factor > 0 DILATES the mask.
  const maskUrls = await replicate.run(MODELS.groundedSam.ref, {
    input: {
      image: rawImageUrl,
      mask_prompt: DESIRED_REGIONS.join(','),
      negative_mask_prompt: 'face,clothing',
      adjustment_factor: Number(process.env.BLUR_MASK_DILATION ?? 12),
    },
  }) as string[]

  if (!maskUrls?.length) {
    // No region found → fail closed: keep fully hidden, route to manual review.
    return { status: 'manual_review' as const, reason: 'no_region_detected' }
  }

  // 2. Composite the blur (our step — Replicate has no turnkey blur model).
  const blurredBuffer = await compositeImageBlur(rawImageUrl, maskUrls[0])

  return { status: 'ready_for_review' as const, blurredBuffer, maskUrl: maskUrls[0] }
}
```

`lib/blur/composite.ts` — the blur compositing for images (sharp is simplest for stills):

```ts
import sharp from 'sharp'

// Apply a heavy Gaussian blur only inside the masked region.
// mask: white = blur here, black = keep sharp.
export async function compositeImageBlur(imageUrl: string, maskUrl: string): Promise<Buffer> {
  const [imgBuf, maskBuf] = await Promise.all([
    fetch(imageUrl).then(r => r.arrayBuffer()).then(Buffer.from),
    fetch(maskUrl).then(r => r.arrayBuffer()).then(Buffer.from),
  ])

  const base = sharp(imgBuf)
  const { width, height } = await base.metadata()

  // Fully-blurred copy of the whole image
  const blurred = await base.clone().blur(30).toBuffer()

  // Use the mask as an alpha channel on the blurred layer, composite over the sharp original
  const blurredMasked = await sharp(blurred)
    .joinChannel(await sharp(maskBuf).resize(width, height).toColourspace('b-w').toBuffer())
    .png()
    .toBuffer()

  return sharp(imgBuf).composite([{ input: blurredMasked, blend: 'over' }]).jpeg({ quality: 85 }).toBuffer()
}
```

> **Runtime note:** `sharp` is **not** available in the Edge runtime. Any route that composites must declare `export const runtime = 'nodejs'`.

---

## 7. Phase P1 — Video Pipeline (PoC)

**Goal:** one clip → mask track → composited blur, audio preserved. This is the hard path; build it carefully.

### 7.1 Keyframe detection → boxes

`lib/blur/detect.ts`:

```ts
import { getReplicate, MODELS, DESIRED_REGIONS } from './replicate'
import type { DetectedRegion } from '@/lib/db/schema'

// Run grounding-dino on a single extracted keyframe.
export async function detectRegions(frameUrl: string, frameIndex: number): Promise<DetectedRegion[]> {
  const replicate = getReplicate()
  const out = await replicate.run(MODELS.groundingDino.ref, {
    input: {
      image: frameUrl,
      query: DESIRED_REGIONS.join(','),
      box_threshold: Number(process.env.BLUR_BOX_THRESHOLD ?? 0.3),
      text_threshold: 0.25,
      show_visualisation: false,
    },
  }) as { detections: Array<{ bbox: number[]; label: string; confidence: number }> }

  return (out.detections ?? []).map(d => ({
    label: d.label,
    box: d.bbox as [number, number, number, number],
    confidence: d.confidence,
    frame: frameIndex,
  }))
}
```

Keyframes are extracted with ffmpeg at `BLUR_KEYFRAME_FPS` (default 1 fps) and uploaded to temporary public URLs (or processed via signed URLs) so Replicate can fetch them.

### 7.2 Box → SAM2 click-point conversion

`lib/blur/geometry.ts` — **critical**: SAM2-video takes points `[x,y]`, not boxes (PRD §13).

```ts
import type { DetectedRegion } from '@/lib/db/schema'

// SAM2-video wants parallel arrays: click_coordinates, click_frames, click_labels, click_object_ids.
export function regionsToSam2Clicks(regions: DetectedRegion[]) {
  const coords: string[] = []      // "[x,y]"
  const frames: number[] = []      // frame index per click
  const labels: number[] = []      // 1 = foreground
  const objectIds: string[] = []   // distinct id per tracked region

  regions.forEach((r, i) => {
    const [x1, y1, x2, y2] = r.box
    const cx = Math.round((x1 + x2) / 2)
    const cy = Math.round((y1 + y2) / 2)
    coords.push(`[${cx},${cy}]`)
    frames.push(r.frame ?? 0)
    labels.push(1)
    objectIds.push(`${r.label}_${i}`)
  })

  return {
    click_coordinates: coords.join(','),
    click_frames: frames.join(','),
    click_labels: labels.join(','),
    click_object_ids: objectIds.join(','),
  }
}
```

### 7.3 Track masks across the whole clip

`lib/blur/track.ts`:

```ts
import { getReplicate, MODELS } from './replicate'
import { regionsToSam2Clicks } from './geometry'
import type { DetectedRegion } from '@/lib/db/schema'

// Returns a mask track. mask_type 'binary' → B&W masks suitable for ffmpeg alpha compositing.
export async function trackMasks(videoUrl: string, regions: DetectedRegion[], webhookUrl?: string) {
  const replicate = getReplicate()
  const clicks = regionsToSam2Clicks(regions)

  return replicate.models.predictions.create({
    model_owner: MODELS.sam2Video.owner,
    model_name: MODELS.sam2Video.name,
    input: {
      input_video: videoUrl,
      ...clicks,
      mask_type: 'binary',
      output_video: true,     // single mask video is easier to composite than a frame sequence
      video_fps: 30,
    },
    ...(webhookUrl ? { webhook: webhookUrl, webhook_events_filter: ['completed'] } : {}),
  })
}
```

> If the region is lost during fast motion, swap `MODELS.sam2Video` for `MODELS.samurai` (motion-aware memory).

### 7.4 Composite blur with ffmpeg (mask track + original)

`lib/blur/composite.ts` (video branch). The key is `alphamerge` + `overlay`, and **mux the original audio back**:

```ts
import ffmpegPath from '@ffmpeg-installer/ffmpeg'
import ffmpeg from 'fluent-ffmpeg'
ffmpeg.setFfmpegPath(ffmpegPath.path)

// originalPath: the source clip. maskVideoPath: B&W mask track from SAM2.
export function compositeVideoBlur(originalPath: string, maskVideoPath: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(originalPath)       // [0] video + audio
      .input(maskVideoPath)      // [1] mask
      .complexFilter([
        // Build a fully-blurred copy of the source
        '[0:v]boxblur=30:5[blurred]',
        // Use the mask as alpha on the blurred layer
        '[blurred][1:v]alphamerge[blurmasked]',
        // Overlay the masked-blur back onto the sharp original
        '[0:v][blurmasked]overlay[outv]',
      ])
      .outputOptions([
        '-map', '[outv]',
        '-map', '0:a?',          // copy original audio if present (the '?' = optional)
        '-c:a', 'copy',
      ])
      .save(outPath)
      .on('end', () => resolve())
      .on('error', reject)
  })
}
```

> **Vercel caveat:** ffmpeg + long video can exceed function memory/time. For P1 PoC run locally or in a Node script; production moves compositing into the Cog (Strategy B, §11) or chunks the video (§10).

---

## 8. Phase P2 — Async Orchestration + State Machine

Video far exceeds the 300s function ceiling → **fire-and-return + webhooks** (PRD §5).

### 8.1 Ingest — start the job, return immediately

`app/api/blur/ingest/route.ts`:

```ts
import { NextRequest } from 'next/server'
import { createJob, setJobStage } from '@/lib/blur/jobs'
import { getSignedUrl } from '@vercel/blob'
import { detectStage } from '@/lib/blur/state'

export const runtime = 'nodejs'
export const maxDuration = 60   // just enough to kick off — NOT to process

export async function POST(req: NextRequest) {
  const { rawBlobKey, creatorId, mediaType } = await req.json()

  // 1. Persist a job row (status: 'uploaded')
  const job = await createJob({ rawBlobKey, creatorId, mediaType })

  // 2. Signed URL Replicate can fetch — TTL longer than the worst-case job.
  const signedRawUrl = await getSignedUrl(rawBlobKey, {
    expiresIn: 60 * 30,   // 30 min — must outlive the whole pipeline (PRD §12.7)
    token: process.env.BLOB_READ_WRITE_TOKEN!,
  })

  // 3. Kick off the first Replicate stage with a webhook; do NOT await completion.
  await detectStage(job.id, signedRawUrl, mediaType)

  // 4. Return now. Replicate calls /api/blur/webhook when the stage finishes.
  return Response.json({ jobId: job.id, status: 'detecting' })
}
```

### 8.2 State machine

`lib/blur/state.ts` — each stage starts the next Replicate prediction with a webhook pointing back. The webhook handler advances the machine.

```
uploaded
   │  detectStage()        → grounding-dino / grounded_sam   (webhook)
detecting
   │  on webhook: store regions + confidence
   │    confidence < BLUR_MIN_CONFIDENCE  → manual_review   (FAIL CLOSED)
   │    image  → compositeStage()
   │    video  → trackStage()            → sam-2-video       (webhook)
tracking
   │  on webhook: compositeStage()       → ffmpeg / cog      (webhook or inline)
compositing
   │  on webhook: write derivatives, link post
ready_for_review
   │  creator approve → publish ; reject → re-run / manual
approved → published
```

Each transition is a small function that (a) updates `blur_jobs.status` + `predictionIds`, (b) creates the next prediction with `webhook: ${NEXT_PUBLIC_APP_URL}/api/blur/webhook?job=${jobId}&stage=track`.

### 8.3 Webhook receiver — verified + idempotent

`app/api/blur/webhook/route.ts`:

```ts
import { NextRequest } from 'next/server'
import { Webhook } from 'svix'
import { advance } from '@/lib/blur/state'
import { wasProcessed, markProcessed } from '@/lib/blur/jobs'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const raw = await req.text()   // raw body REQUIRED for signature verification
  const headers = {
    'webhook-id': req.headers.get('webhook-id')!,
    'webhook-timestamp': req.headers.get('webhook-timestamp')!,
    'webhook-signature': req.headers.get('webhook-signature')!,
  }

  // 1. Verify the signature BEFORE trusting anything (PRD §12.5)
  let event: any
  try {
    const wh = new Webhook(process.env.REPLICATE_WEBHOOK_SECRET!)
    event = wh.verify(raw, headers)
  } catch {
    return new Response('Invalid signature', { status: 401 })
  }

  // 2. Idempotency — a retried webhook must not double-write (PRD §12.6)
  if (await wasProcessed(event.id)) return Response.json({ ok: true, deduped: true })

  const { searchParams } = new URL(req.url)
  const jobId = searchParams.get('job')!
  const stage = searchParams.get('stage')!

  if (event.status === 'failed') {
    await advance(jobId, 'failed', { error: event.error })
  } else if (event.status === 'succeeded') {
    await advance(jobId, stage, { output: event.output })  // moves machine forward
  }

  await markProcessed(event.id)
  return Response.json({ ok: true })
}
```

> Replicate webhooks use svix-style signing headers (`webhook-id`, `webhook-timestamp`, `webhook-signature`). The raw request body must be passed to `verify()` unparsed.

---

## 9. Phase P3 — Creator Review Gate

Hard rule: **nothing public until the creator approves** (PRD §11).

### 9.1 Review page

`app/(creator)/blur-review/[id]/page.tsx` — server component fetches the job; client `ReviewPanel` renders:
- The **blurred preview** (from the public-pending derivative) with `RegionOverlay` drawing `blur_jobs.regions` boxes.
- Three actions wired to the API routes below.

### 9.2 Approve → publish

`app/api/blur/jobs/[id]/approve/route.ts`:
- Move `blurred` derivative to a **public** blob; keep `original` private.
- Create/link the `posts` row: set `posts.blurredPreviewUrl` (public) + `posts.privateMediaKey` (private) — the fields already in the parent schema.
- `blur_jobs.status → published`.

### 9.3 Reject → adjust or manual

`app/api/blur/jobs/[id]/reject/route.ts`:
- **Adjust:** re-run with stronger params (`adjustment_factor +`, lower `box_threshold`). Increment `attempts`.
- **Manual mask:** `ManualMaskCanvas` lets the creator click the region; those points feed `regionsToSam2Clicks` directly (highest-accuracy seed — bypasses detection entirely).

---

## 10. Phase P4 — Production Hardening

| Item | Implementation |
|---|---|
| **Long-video chunking** | Split source with ffmpeg `segment`; process each chunk through the pipeline; `concat` the blurred chunks. Enables partial retry. |
| **Warm latency** | Create a Replicate **deployment** for the hottest model with a min instance to avoid cold model boot (tens of seconds). Call via `deployments.predictions.create`. |
| **Cost logging** | On every webhook, record `event.metrics.total_time` to a `blur_cost_log` (or onto the job) so spend is observed, not estimated (PRD §14). |
| **Retries / backpressure** | Guard with `blur_jobs.attempts`; cap re-runs. Optionally move job dispatch behind **Vercel Queues** (beta) for at-least-once delivery. |
| **Motion fallback** | If `tracking` produces low mask coverage, automatically re-run with `MODELS.samurai`. |
| **De-flicker** | Prefer SAM2 tracking over per-frame detection; if jitter persists, temporally smooth mask boundaries before compositing. |
| **Webhook reconciliation** | A cron (`/api/blur/reconcile`) polls `predictions.get` for jobs stuck >N min (missed webhooks). |

---

## 11. Phase P5 — Single Cog Pipeline (Strategy B)

Collapse the whole chain into **one hosted Replicate model** → one API call per asset, compositing on the GPU box (no re-download), no ffmpeg-in-serverless. We author the container once; Replicate runs it.

`auto-blur/cog/cog.yaml`:
```yaml
build:
  gpu: true
  python_version: "3.11"
  system_packages: ["ffmpeg"]
  python_packages:
    - "torch"
    - "groundingdino-py"
    - "segment-anything-2"
    - "opencv-python-headless"
predict: "predict.py:Predictor"
```

`auto-blur/cog/predict.py` (skeleton — logic only, no secrets):
```python
from cog import BasePredictor, Input, Path

class Predictor(BasePredictor):
    def setup(self):
        # load Grounding DINO + SAM2 weights once per container boot
        ...

    def predict(
        self,
        video: Path = Input(description="Source clip"),
        regions: str = Input(default="breast,genitalia,buttocks,nipple"),
        box_threshold: float = Input(default=0.3),
        dilation: int = Input(default=12),
        blur_strength: int = Input(default=30),
    ) -> Path:
        # 1. sample keyframes  2. Grounding DINO → boxes  3. boxes → SAM2 points
        # 4. SAM2 video → mask track  5. ffmpeg blur+alphamerge+overlay (keep audio)
        # 6. return finished blurred mp4
        ...
```

Push and cut over:
```bash
cd auto-blur/cog
cog push r8.im/<your-username>/veil-autoblur
# Then in lib/blur/replicate.ts add: veilAutoblur: { ref: '<username>/veil-autoblur:<hash>' }
# Orchestration shrinks to a single prediction + one webhook.
```

---

## 12. Testing & Verification

- **Unit:** `geometry.ts` box→point conversion (pure function — table-test edge boxes, multi-region).
- **Golden-image:** a fixed test image through `processImage`; assert the masked region's average pixel variance dropped below a blur threshold and the unmasked region is unchanged.
- **Leak test:** assert blur extends ≥ `BLUR_MASK_DILATION` px beyond the detected box (no edge skin).
- **Audio test:** assert the composited clip retains an audio stream (`ffprobe`).
- **Webhook:** replay a captured Replicate payload with a bad signature → expect 401; good signature + duplicate `event.id` → expect dedupe.
- **Fail-closed:** feed an image with no detectable region → assert status `manual_review`, never `published`.
- **E2E happy path:** upload → poll job → `ready_for_review` → approve → preview is public, original still 403s without payment.

---

## 13. Build Order & Time Budget

| Phase | Deliverable | Est. |
|---|---|---|
| Setup | Deps, token, webhook secret, pinned versions, `blur_jobs` table | 1.5h |
| P0 | Image: `grounded_sam` → sharp composite → derivatives | 3h |
| P1 | Video: keyframe detect → box→point → `sam-2-video` → ffmpeg composite (run locally) | 5h |
| P2 | Async: ingest fire-and-return, state machine, verified idempotent webhook | 5h |
| P3 | Review UI: side-by-side, overlay, approve/reject/manual-mask | 4h |
| P4 | Chunking, warm deployment, cost log, reconcile cron, motion fallback | 5h |
| P5 | Cog pipeline authored, pushed, orchestration cut over to one call | 6h |

> Validate quality (P0–P1) before building infrastructure (P2+). Each phase is independently demoable.

---

## 14. Pitfall → Code Mitigation Map

| PRD Pitfall | Where it's handled here |
|---|---|
| SAM2 needs points, not boxes | `geometry.ts` `regionsToSam2Clicks` (§7.2) |
| SAM2 returns masks, not blurred video | `composite.ts` ffmpeg `alphamerge`+`overlay` (§7.4) |
| Per-frame detection overspend/flicker | Keyframe sampling at `BLUR_KEYFRAME_FPS`, SAM2 interpolates (§7.1) |
| Private blob not fetchable by Replicate | Signed URL in `ingest` with 30-min TTL (§8.1) |
| Sync request times out on video | Fire-and-return + webhook state machine (§8) |
| Edge leakage | `adjustment_factor` / `BLUR_MASK_DILATION` (§5, §6) |
| Audio dropped | `-map 0:a? -c:a copy` in ffmpeg (§7.4) |
| Spoofed webhook | `svix` signature verify before acting (§8.3) |
| Duplicate webhook | `wasProcessed(event.id)` idempotency (§8.3) |
| Cold model boot | Replicate deployment with warm instance (§10) |
| Fast-motion region loss | `MODELS.samurai` fallback (§7.3, §10) |
| Auto-publish on low confidence | `BLUR_MIN_CONFIDENCE` → `manual_review`; creator approve gate (§8.2, §9) |
| Unpinned community versions | `REPLICATE_*_VERSION` env pins (§3, §5) |
| `sharp` in Edge runtime | `export const runtime = 'nodejs'` (§6) |

---

*Companion to [PRD.md](./PRD.md). All Replicate model fields referenced here were verified live against the API on 2026-06-18.*
