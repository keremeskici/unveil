# PRD — Auto-Blur Pipeline ("Veil Vision")

> Automatic detection and blurring of "most-desired" regions in creator-uploaded
> images and video, using **hosted inference APIs only** — no self-hosted models,
> no GPU infrastructure to manage.
>
> **Module of:** Veil (mpp-onlyfans). Lives on branch `feature/auto-blur-pipeline`.
> **Status:** Pre-implementation spec. No code yet.
> **Owner:** Kerem · **Last updated:** 2026-06-18

---

## Table of Contents

1. [Problem & Goals](#1-problem--goals)
2. [Non-Goals](#2-non-goals)
3. [Core Constraint: Hosted-Only Inference](#3-core-constraint-hosted-only-inference)
4. [The Verified Model Landscape (Replicate)](#4-the-verified-model-landscape-replicate)
5. [Architecture Overview](#5-architecture-overview)
6. [The Processing Pipeline (Step by Step)](#6-the-processing-pipeline-step-by-step)
7. [Two Implementation Strategies](#7-two-implementation-strategies)
8. [Tech Stack (Established)](#8-tech-stack-established)
9. [Data Model Additions](#9-data-model-additions)
10. [API Surface (Described, Not Coded)](#10-api-surface-described-not-coded)
11. [Creator UX: The Confirm-Before-Publish Gate](#11-creator-ux-the-confirm-before-publish-gate)
12. [Best Practices](#12-best-practices)
13. [Common Pitfalls](#13-common-pitfalls)
14. [Cost Analysis](#14-cost-analysis)
15. [Security, Privacy & Legal](#15-security-privacy--legal)
16. [Phasing & Milestones](#16-phasing--milestones)
17. [Open Questions](#17-open-questions)

---

## 1. Problem & Goals

When a creator uploads a photo or video, the platform must produce **two derivatives**:

- A **blurred preview** (public) — the "most-desired" regions obscured, served to fans before payment.
- The **original** (private) — released via signed URL only after a paid unlock (see parent [IMPLEMENTATION.md](../IMPLEMENTATION.md) §6–7).

Today this would be manual. The goal of this module is to make the blurring **automatic**: the creator uploads once, the system detects the regions to obscure and renders the blurred preview without human pixel-pushing — while keeping a creator review step so nothing is published the creator didn't approve.

**Primary goals**

| # | Goal | Success criterion |
|---|---|---|
| G1 | Auto-detect "desired" regions in images & video | ≥90% of obvious cases detected without manual input |
| G2 | Render a clean, motion-stable blur that tracks the region across video frames | No visible region leakage on the happy-path demo clip |
| G3 | Zero self-hosted models or GPUs | All inference via Replicate's hosted API |
| G4 | Fail **closed** — never auto-publish if detection is uncertain | Low-confidence results route to manual review, stay private |
| G5 | Creator confirms the blur before it goes public | Hard gate; no preview is public without explicit creator approval |

---

## 2. Non-Goals

- **Not** real-time / on-the-fly blurring during playback. Blur is rendered once, at upload time, into a derivative asset.
- **Not** a content-moderation/compliance classifier for *banning* content. (A separate NSFW gate may reuse the same detection signal, but policy enforcement is out of scope here.)
- **Not** training or fine-tuning a custom detection model in this phase.
- **Not** in scope for the 42-hour hackathon build. This is a **post-hackathon** module. For the hackathon, seed content is pre-blurred manually. This PRD is the plan for building it for real afterward.

---

## 3. Core Constraint: Hosted-Only Inference

The hard requirement: **we do not host or scale any model.** Every inference call goes to a central hosted API. This rules out running NudeNet/SAM2 on our own GPU boxes, Modal, or self-managed containers.

**Chosen provider: Replicate.** Rationale:
- Hosts all the models we need (detection, segmentation, video tracking) behind one API + one token.
- Pay-per-second of GPU; no idle cost, no infra.
- First-class **async + webhook** support — essential because video jobs exceed any serverless timeout.
- We *can* publish a single custom pipeline model (a Cog container) to Replicate later without ever running our own infrastructure — Replicate runs it on demand. This keeps "hosted-only" true even for our custom compositing logic.

> The Replicate MCP server is connected in this session and was used to **verify** every model, input field, and output type cited below against the live API (not from memory).

---

## 4. The Verified Model Landscape (Replicate)

All models below were confirmed live via the Replicate API. There is **no single turnkey "detect-NSFW-and-blur-this-video" model** — so the pipeline composes purpose-built models. This is the central architectural fact of this PRD.

### 4.1 Detection — text-prompted bounding boxes

**`adirik/grounding-dino`** — "Detect everything with language!" (38.8M runs)

Open-vocabulary detector: you describe targets in natural language, it returns bounding boxes. This is what lets us target "the desired regions" by description rather than a fixed model taxonomy.

```
Input:
  image            (uri)
  query            (string) — comma-separated object names to detect
  box_threshold    (number, default 0.25) — detection confidence
  text_threshold   (number, default 0.25)
  show_visualisation (bool) — draws boxes for debugging
Output:
  detections with bounding boxes (+ optional annotated image)
```

### 4.2 Combined detect + mask (images) — one call

**`schananas/grounded_sam`** — Grounding DINO + Segment Anything in one model (2.69M runs)

For **still images**, this is the efficient path: prompt → pixel mask, in a single prediction.

```
Input:
  image                (uri)
  mask_prompt          (string) — positive prompt, e.g. the regions to mask
  negative_mask_prompt (string) — regions to exclude
  adjustment_factor    (int, default 0) — -ve erodes, +ve DILATES the mask
Output:
  array of mask image URIs
```

> `adjustment_factor` (dilation) is important: blur must extend a few px **beyond** the detected edge to avoid leakage.

### 4.3 Video object segmentation + tracking

**`meta/sam-2-video`** — official SAM 2 for video (75.6k runs). The core of video blurring.

```
Input:
  input_video        (uri, required)
  click_coordinates  (string, required) — '[x,y],[x,y],...'  ← POINTS, not boxes
  click_frames       (string) — frame index per click, e.g. '0,0,150'
  click_labels       (string) — 1=foreground, 0=background
  click_object_ids   (string) — track multiple distinct objects
  mask_type          (binary | highlighted | greenscreen)
  annotation_type    (mask | bounding_box | both)
  output_video       (bool) — true=video, false=image sequence
  video_fps          (int)
Output:
  array of frame URIs (or a video) — these are MASKS, not blurred footage
```

**Two critical facts:**
1. SAM2-video is prompted with **click points `[x,y]`, not bounding boxes.** We must convert detection boxes → representative point(s) (box center, plus optional interior samples).
2. Its output is a **mask track**, not a blurred video. A separate **compositing** step applies the actual blur using the mask. Replicate has no turnkey model for that compositing step (see §7).

**`zsxkib/samurai`** — "SAMURAI: motion-aware memory for zero-shot tracking" (alt to SAM2-video)

Better at **fast motion** and occlusion than vanilla SAM2-video. Candidate fallback/upgrade when SAM2-video loses the region during quick movement.

### 4.4 Classification gate (optional, cheap pre-filter)

- **`falcons-ai/nsfw_image_detection`** — ViT NSFW classifier (115M runs). Whole-image NSFW score, **no boxes**. Use as a cheap "does this even need processing?" gate.
- **`lucataco/nsfw_video_detection`** — the same extended to video.

### 4.5 What does NOT exist (so we must build the glue)

- No hosted model that takes "a video" and returns "the same video with NSFW regions blurred."
- `kharioki/blur-faces` only blurs faces in a single image — not general regions, not video.
- ⇒ The **blur compositing** (mask + original → blurred output, audio preserved) is **our** step. We either run it as a custom Cog on Replicate (§7 Strategy B) or in a serverless ffmpeg step (§7 Strategy A).

---

## 5. Architecture Overview

```
                         ┌─────────────────────────────────────────────┐
   Creator uploads       │  Veil app (Next.js on Vercel, Fluid Compute) │
   image / video  ─────► │                                              │
                         │  /api/blur/ingest  (kicks off job, returns)  │
                         └───────────────┬──────────────────────────────┘
                                         │ 1. store RAW (private Blob)
                                         │ 2. create job row (Neon)
                                         │ 3. create Replicate prediction(s)
                                         │    with webhook → /api/blur/webhook
                                         ▼
                         ┌──────────────────────────────────────────────┐
                         │              REPLICATE (hosted API)           │
                         │  grounding-dino → sam-2-video → [composite]   │
                         │  (no infra on our side; pay per GPU-second)   │
                         └───────────────┬──────────────────────────────┘
                                         │ webhook: prediction completed
                                         ▼
                         ┌──────────────────────────────────────────────┐
                         │  /api/blur/webhook (verify signature)         │
                         │  - advance state machine                      │
                         │  - on final stage: write derivatives          │
                         │      blurred  → PUBLIC Blob                    │
                         │      original → PRIVATE Blob                   │
                         │  - mark job READY_FOR_REVIEW                   │
                         └───────────────┬──────────────────────────────┘
                                         ▼
                         ┌──────────────────────────────────────────────┐
                         │  Creator review UI → approve → PUBLISH         │
                         │  (only now does the preview become public)     │
                         └──────────────────────────────────────────────┘
```

**Why webhook-driven, not request/response:** A 30-second 1080p clip at even modest sampling is many GPU-seconds across multiple model calls. This blows past Vercel's 300s function ceiling. The ingest endpoint must **fire-and-return**; Replicate calls us back per stage. State lives in the DB, not in a hanging request.

---

## 6. The Processing Pipeline (Step by Step)

### Image path (simpler)

1. **Ingest** — store raw image in a private Blob; create job row; generate a **signed, time-limited URL** Replicate can fetch (Replicate pulls inputs over HTTPS — it cannot read a private blob without a fetchable URL).
2. **Detect + mask** — one call to `schananas/grounded_sam` with the region prompt and a positive `adjustment_factor` (dilation). Returns a mask.
3. **Composite blur** — apply Gaussian/mosaic blur to masked region over the original (our step — see §7).
4. **Persist** — blurred → public Blob; original → private Blob; mark `READY_FOR_REVIEW`.

### Video path (the hard one)

1. **Ingest** — store raw video (private Blob); job row; signed URL with TTL **longer than the whole job** (jobs can run minutes).
2. **(Optional) NSFW gate** — `nsfw_video_detection` to skip clips that need no processing and save GPU spend.
3. **Keyframe detection** — extract keyframes (e.g. 1 frame/sec) and run `grounding-dino` per keyframe to locate regions → bounding boxes per keyframe.
4. **Box → point conversion** — convert each box to SAM2 click point(s): box center as a foreground point (label 1), plus optional interior samples; map each to its `click_frame`.
5. **Track masks** — one `sam-2-video` call seeded with those points across keyframes; outputs a **mask track** for the whole clip. SAM2's temporal memory interpolates between keyframes so we don't detect every frame.
6. **Composite blur** — combine mask track + original footage, apply blur, **preserve the audio track**.
7. **Persist + review** — blurred → public Blob; original → private Blob; `READY_FOR_REVIEW`.

> Detection runs on **keyframes**, tracking fills the gaps. Running `grounding-dino` on every frame is the #1 way to overspend (§14) and also causes blur **flicker** (§13).

---

## 7. Two Implementation Strategies

The only real decision is **where the compositing (mask→blurred output) step runs.** Both keep inference hosted.

### Strategy A — Compose public models + serverless ffmpeg compositing

- Detection/segmentation via the public Replicate models above.
- The blur compositing (mask + original → blurred, audio-preserved) runs in a **Vercel Function** (or a short Replicate ffmpeg utility model) using ffmpeg.

| Pros | Cons |
|---|---|
| Nothing to build/push to Replicate; ship fast | ffmpeg in serverless is fiddly (binary size, `maxDuration`, memory) |
| Each stage independently debuggable/swappable | Multiple round-trips = more orchestration + webhook hops |
| Lowest upfront effort | Compositing long video may exceed function limits → must chunk |

### Strategy B — One custom Cog pipeline model on Replicate (recommended for production)

- Author **one** Cog container that internally chains: Grounding DINO → SAM2-video → ffmpeg blur, and **returns the finished blurred video**.
- Push it to Replicate once. From then on it's **one hosted API call**; Replicate runs it on demand. We still host no infra.

| Pros | Cons |
|---|---|
| One API call per asset; trivial orchestration | One-time effort to author & push the Cog |
| Compositing runs on the GPU box next to the masks (fast, no re-download) | We maintain the container's model versions |
| No ffmpeg-in-serverless headaches | Slightly less granular per-stage observability |

**Recommendation:** Start on **Strategy A** to validate detection/blur quality with zero build overhead. Once the prompts and thresholds are dialed in, **graduate to Strategy B** for a clean one-call production pipeline. Both satisfy the hosted-only constraint.

---

## 8. Tech Stack (Established)

| Layer | Choice | Notes |
|---|---|---|
| **Inference** | **Replicate** (hosted API) | `grounding-dino`, `grounded_sam`, `sam-2-video`, `samurai`, `nsfw_*` |
| **Replicate client** | `replicate` npm SDK (server-side only) | `REPLICATE_API_TOKEN` server env var, never client |
| **Custom pipeline (Strategy B)** | **Cog** (Replicate's container format) | Authored once, pushed to Replicate; no infra on our side |
| **Orchestration / API** | **Next.js App Router on Vercel, Fluid Compute** | Node.js runtime; ingest fires-and-returns |
| **Job state** | **Neon Postgres + Drizzle** (existing) | New `blur_jobs` table; state machine |
| **Async** | **Replicate webhooks** → Vercel route | Signature-verified; DB-backed idempotency |
| **Queue (optional)** | **Vercel Queues** (beta) or DB-as-queue | For retry/backpressure if volume grows |
| **Storage** | **Vercel Blob** | RAW + original = private; blurred preview = public |
| **Compositing (Strategy A)** | **ffmpeg** | Gaussian blur / mosaic via mask overlay; preserve audio |
| **Webhook verification** | Replicate signing secret (svix-style) | Fetched via `webhooks.default.secret.get` |
| **Frame extraction (Strategy A)** | ffmpeg keyframe sampling | 1 fps default, tunable |

Everything else (auth, wallet, payments, feed) is unchanged from the parent app.

---

## 9. Data Model Additions

A new table in the existing Drizzle schema (described, not coded):

**`blur_jobs`**
- `id` (uuid, pk)
- `post_id` (fk → posts; nullable until the post is created)
- `creator_id` (fk → users)
- `media_type` (image | video)
- `status` (enum: `uploaded` → `detecting` → `tracking` → `compositing` → `ready_for_review` → `approved` → `published` → `failed` → `manual_review`)
- `raw_blob_key` (private)
- `blurred_blob_url` (public, set on success)
- `original_blob_key` (private, set on success)
- `replicate_prediction_ids` (jsonb — one per stage, for correlation + cancel)
- `detection_confidence` (numeric — drives the fail-closed routing)
- `regions` (jsonb — detected boxes/labels, for the review UI overlay)
- `error` (text, nullable)
- `attempts` (int — retry guard)
- `created_at`, `updated_at`

The `posts` table gains nothing required, but the publish step links `blur_jobs.post_id` and sets `posts.blurredPreviewUrl` + `posts.privateMediaKey` (the fields already defined in the parent schema).

---

## 10. API Surface (Described, Not Coded)

| Route | Method | Purpose |
|---|---|---|
| `/api/blur/ingest` | POST | Accept upload metadata, store raw, create job, kick off first Replicate prediction with webhook. Returns `{ jobId }` immediately. |
| `/api/blur/webhook` | POST | Replicate callback. **Verify signature first.** Advance the state machine; on the final stage, write derivatives and set `ready_for_review`. Idempotent on `prediction.id`. |
| `/api/blur/jobs/:id` | GET | Poll job status for the creator UI (fallback to webhooks). |
| `/api/blur/jobs/:id/approve` | POST | Creator approves the blurred preview → publish (preview becomes public, post goes live). |
| `/api/blur/jobs/:id/reject` | POST | Creator rejects → re-run with adjusted params, or route to manual masking. |

**Direct-upload note:** large videos should use Vercel Blob **client upload** (up to 5 TB) so the file never passes through a function body; the function only receives the resulting blob key.

---

## 11. Creator UX: The Confirm-Before-Publish Gate

This is a **hard product rule**, not a nicety:

1. Creator uploads → sees a "Processing…" state (job is async).
2. When `ready_for_review`, creator sees the **blurred preview side-by-side** with region overlays.
3. Creator can: **Approve** (publish), **Adjust** (stronger blur / bigger region → re-run), or **Manual mask** (draw the region themselves; we seed SAM2 with their points — higher accuracy than pure auto-detect).
4. **Nothing becomes public until Approve.** The original always stays private regardless.

Why: auto-detection has a residual miss rate (§13). The confirm step converts a model-accuracy risk into a creator decision — and creator-drawn points are the most accurate seed for SAM2 anyway, so this doubles as a quality feature.

---

## 12. Best Practices

1. **Fail closed.** If detection confidence is below threshold, the job goes to `manual_review` and the asset stays private. The default state of any unprocessed/uncertain asset is "fully hidden," never "exposed."
2. **Detect on keyframes, track for the rest.** Seed SAM2 from sparse keyframe detections; let its temporal memory interpolate. Cheaper and less flickery than per-frame detection.
3. **Dilate the mask.** Always blur a margin beyond the detected edge (`adjustment_factor` > 0, or ffmpeg mask dilation) to prevent edge leakage from imperfect masks.
4. **Webhooks, not polling loops.** Register `webhook` + `webhook_events_filter: ["completed"]` on every prediction. Use `predictions.get` only as a reconciliation fallback for missed webhooks.
5. **Always verify webhook signatures** with Replicate's signing secret before acting. Treat the webhook body as untrusted until verified.
6. **Idempotent webhook handling.** Key on `prediction.id`; a retried webhook must not double-write derivatives or double-charge GPU.
7. **Signed input URLs must outlive the job.** Replicate fetches inputs over HTTPS; if the signed URL TTL expires mid-job, the prediction fails. Size TTL to worst-case job duration.
8. **Preserve the audio track.** The compositing step must mux original audio back; a blur filter on video frames silently drops audio if not handled.
9. **Pin model versions.** For community models, pin the exact `version` hash for reproducibility; official models (`meta/*`) can be called by name. Re-test when bumping.
10. **Use Replicate deployments for production latency.** A deployment with a warm min-instance avoids cold model-boot (tens of seconds) on each job — worth it once volume justifies the idle cost.
11. **Chunk long videos.** Split clips beyond a threshold, process per-chunk, concatenate. Keeps each prediction within limits and enables partial retry.
12. **Cap and de-flicker.** Smooth mask boundaries across frames (rely on SAM2 tracking rather than re-detecting) so the blur doesn't jitter frame to frame.

---

## 13. Common Pitfalls

| Pitfall | Symptom | Mitigation |
|---|---|---|
| Treating SAM2-video like it takes boxes | API rejects input / bad masks | It takes **click points `[x,y]`**. Convert detection box → center point(s). |
| Expecting SAM2-video to return blurred video | Output is B&W/colored masks, not footage | It returns a **mask track**. Add a compositing step (§7). |
| Per-frame detection | Huge GPU bill + blur flicker | Detect on keyframes; track between (§12.2). |
| Private blob passed to Replicate | Prediction fails to fetch input | Pass a **signed HTTPS URL**; TTL > job duration (§12.7). |
| Synchronous request for video | Function times out at 300s | Fire-and-return + webhooks (§5). |
| No mask dilation | Thin halo of unblurred skin at region edges | Dilate mask / blur a margin (§12.3). |
| Audio dropped after compositing | Blurred clip is silent | Mux original audio back in ffmpeg (§12.8). |
| Unverified webhook | Spoofed callback could publish unblurred content | Verify signature before acting (§12.5). |
| Non-idempotent webhook | Duplicate derivatives / double GPU spend on retries | Key on `prediction.id` (§12.6). |
| Cold model boot every job | First call adds 10–60s latency | Use a warm **deployment** in production (§12.10). |
| Fast motion loses the region | Region briefly unblurred mid-clip | Switch tracker to `zsxkib/samurai` (motion-aware); or add keyframe near the motion. |
| Auto-publish on low confidence | Wrong/under-blurred content goes public | **Fail closed** + creator confirm gate (§11, §12.1). |
| Unpinned community model version | Output changes silently after an upstream update | Pin `version` hash (§12.9). |
| Trusting one detection pass | Edge cases slip through (~5–15% miss) | Confidence threshold + manual-mask fallback (§11). |

---

## 14. Cost Analysis

Replicate bills GPU-seconds per prediction; cost scales with **frames processed × model**, not wall-clock.

**Cost levers (in priority order):**
1. **Keyframe sampling rate** — detection cost is roughly linear in keyframes. 1 fps vs 30 fps is a ~30× swing.
2. **NSFW pre-gate** — skip clips that need no processing entirely.
3. **Resolution** — downscale for *detection* (boxes don't need 4K), composite blur at full res.
4. **Strategy B (single Cog)** avoids re-downloading the video between stages (mask and original are already on the GPU box), trimming transfer time.

Rough order of magnitude (validate empirically before quoting): a short clip is on the order of **single-digit-to-low-tens of cents** to process end-to-end. Against a per-unlock revenue model where a single clip is unlocked many times, processing cost is **negligible per asset** — but per-frame detection can quietly multiply it, so the keyframe lever matters.

> Add cost-per-job logging (`metrics.total_time` is returned on every prediction) from day one so spend is observable, not estimated.

---

## 15. Security, Privacy & Legal

- **Third-party processing of sensitive media.** Explicit/intimate content is sent to Replicate for inference. Review Replicate's data-retention terms; prefer accounts/settings that **minimize retention** (the prediction object exposes a `data_removed` flag). Document this in the creator ToS.
- **Signed-URL exposure window.** The raw upload is briefly fetchable via signed URL so Replicate can read it. Keep TTLs as short as the job allows; scope URLs to the single asset.
- **The original never goes public.** Auto-blur produces a *preview*; the original stays in private storage and is gated by payment exactly as in the parent app. Auto-blur is additive, never a replacement for server-side gating.
- **Fail-closed is also a legal safeguard.** A miss that exposes content is a reputational/legal liability; routing uncertainty to manual review (never to publish) is the conservative default.
- **Creator consent & ownership.** Only the uploading creator's own content is processed; the confirm gate documents their approval of each published preview.
- **Secrets.** `REPLICATE_API_TOKEN` and the webhook signing secret are server-only env vars — never `NEXT_PUBLIC_`.

---

## 16. Phasing & Milestones

| Phase | Deliverable | Strategy |
|---|---|---|
| **P0 — Image PoC** | Single image → `grounded_sam` → ffmpeg blur → blurred + original derivatives. Validates prompts, thresholds, dilation. | A |
| **P1 — Video PoC** | Keyframe `grounding-dino` → point conversion → `sam-2-video` mask track → composite. Validates tracking + de-flicker on one real clip. | A |
| **P2 — Async + state machine** | `blur_jobs` table, ingest fire-and-return, webhook receiver (verified, idempotent), job polling. | A |
| **P3 — Creator review gate** | Side-by-side review UI, approve/adjust/manual-mask, publish flow. | A |
| **P4 — Production hardening** | Chunking long video, warm deployment, cost logging, `samurai` fallback for motion, retries/backpressure. | A→B |
| **P5 — Single Cog pipeline** | Author + push one custom Replicate model that does the full chain in one call. Cut over orchestration to one prediction per asset. | B |

Each phase is independently demoable and shippable; quality (P0–P1) is validated before infrastructure (P2+) is built.

---

## 17. Open Questions

1. **Region taxonomy & prompts** — exact Grounding DINO / grounded_sam prompt strings for the "desired" regions, and per-region confidence thresholds? (Needs empirical tuning on real content.)
2. **Blur style** — hard Gaussian, mosaic/pixelate, or soft gradient reveal? (Parent product leans hard-blur for the tap-to-reveal dopamine hit — confirm.)
3. **Strategy B trigger** — at what volume does authoring the custom Cog pay off vs. staying on composed public models?
4. **`samurai` vs `sam-2-video`** — default to which? Benchmark both on representative motion before committing.
5. **Manual-mask UX depth** — point-click seeding only, or full brush masking in the review UI?
6. **Retention posture** — confirm Replicate data-retention settings acceptable for this content class; finalize ToS language.
7. **Chunk length** — optimal video chunk size for the cost/latency/accuracy tradeoff?
8. **Reprocessing** — if a creator edits region/blur after publish, do we version derivatives or overwrite?

---

## Appendix — Verified Replicate Models (quick reference)

| Model | Role | Input highlights | Output |
|---|---|---|---|
| `adirik/grounding-dino` | Text→box detection | `image`, `query` (comma-sep names), `box_threshold` | bounding boxes |
| `schananas/grounded_sam` | Detect+mask (image) | `image`, `mask_prompt`, `negative_mask_prompt`, `adjustment_factor` | mask URIs |
| `meta/sam-2-video` | Video mask tracking | `input_video`, `click_coordinates` (points!), `click_frames`, `click_labels`, `mask_type` | mask track (not blurred video) |
| `zsxkib/samurai` | Motion-aware video tracking | video + prompts | mask track |
| `falcons-ai/nsfw_image_detection` | NSFW gate (image) | `image` | class/score (no boxes) |
| `lucataco/nsfw_video_detection` | NSFW gate (video) | video | class/score |

*All fields above verified live against the Replicate API on 2026-06-18 via the connected Replicate MCP server.*
