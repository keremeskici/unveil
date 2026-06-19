# Media Player & Blurred Video — Implementation Plan

> Status: **Scoping / design.** No code written yet.
> Scope: extend Veil's pay-per-tap blur-to-reveal from images to **video**, including a
> new **partial (per-region) reveal** mode where the clip plays for free and blurred
> areas carry their own dollar-priced "tap to reveal" buttons.

---

## 1. What we're building

Three capabilities, mapped to the request:

| # | Requirement | Mode |
|---|-------------|------|
| **F1** | Play uploaded videos from our storage, gated like images are today. | **Full gate** — whole clip locked, one payment reveals everything. |
| **F2** | Blurred and clean versions co-exist; on unlock the blur **animates away** (fade), not a hard cut. | Applies to both modes. |
| **F3** | Clip is **not fully blocked** — it plays without paying, but blurred regions each show a **$X button** that reveals just that region. | **Partial gate** — per-region micro-unlocks. |

F1 + F2 are a moderate extension of what already exists. **F3 is the genuinely new architecture** and most of the risk lives there (mobile video decoders, A/V sync, per-region payments). The plan ships them in that order.

### 1.1 Hackathon scope lock (confirmed constraints)

These constraints are **decided** and the plan below is tuned to them — they retire most of the hard pitfalls:

- **Clips are ≤ 7–8 seconds**, single short MP4.
- **Partial posts carry ~2 priced regions** (cap at 2–3; don't build for N).
- **F3 (partial reveal) is in demo scope** alongside full-gate video.

What this lets us drop / simplify:

| Concern | Why it's no longer a risk at this scale | Decision |
|---|---|---|
| iOS concurrent decoder ceiling | 1 base + 2 patches = **3 decoders** — fine on any modern iPhone | **Option A confirmed**; drop the Option B recomposite fallback |
| Signed-URL expiry mid-playback | 300s TTL ≫ 8s clip; whole file buffers in the first range request and loops from memory | Direct presigned URLs are acceptable for the demo; the redirect route (§7) becomes a **robustness nice-to-have, not a blocker** |
| A/V sync drift | Negligible over 8s; clips can `preload="auto"` fully and stay frame-stable | rVFC drift correction stays (cheap) but is not load-bearing |
| HLS / adaptive bitrate | Pointless for an 8s clip | **Out.** Progressive MP4 only |
| Region clustering complexity | Only ~2 regions to separate | Trivial — no general N-region clustering needed |

---

## 2. What already exists (don't rebuild this)

The blur-to-reveal economy is already built for images and is **media-agnostic at the data and payment layers**. Grounded references:

- **Schema** (`lib/db/schema.ts`)
  - `posts.mediaType` is `pgEnum("media_type", ["image","video"])` — video is a first-class type already (line 18, 98).
  - `posts.blurredPreviewUrl` (the safe, blurred derivative) and `posts.privateMediaKey` (the clean original) both store **storage pathnames**, presigned on demand — not public URLs (lines 93–95).
  - `posts.unlockPrice` is `decimal(18,8)` in stablecoin units, `"0.05"` = 5¢ (line 97).
  - `unlocks` has a unique `(fanId, postId)` index — **one unlock per fan per post** (line 132). This is why per-region needs its own table (§6).
  - `blur_jobs.regions` is `jsonb` of `DetectedRegion { label, box:[x1,y1,x2,y2], confidence, frame? }` and `blur_jobs.sourceFps` already track **per-frame bounding boxes for video** (lines 227–260). F3 reuses this.
- **Unlock flow** (`app/api/unlock/route.ts`)
  - POST `/api/unlock { postId }` → debits the custodial app-balance ledger, settles creator payout on Tempo, then returns a **short-lived signed URL** for `privateMediaKey`. Already branches `ttl = mediaType === "video" ? 300 : 60` (lines 98, 166).
- **Payments** (`lib/custodial.ts`, `lib/custodial-wallets.ts`)
  - `unlockWithCustodialBalance()` does the atomic debit/escrow + writes the `unlocks` row; `settleUnlockWithCustodialWallet()` signs the Tempo `transferSync` to the platform wallet. F3 will mirror these for regions.
- **Reveal animation** (`components/RevealMedia.tsx`)
  - Blurred preview sits underneath; on reveal a Framer Motion spring runs `blur(15px)→0, scale(1.06)→1, opacity 0→1` over 0.62s with a crimson shimmer, respecting `prefers-reduced-motion`. **This is the F2 animation — we reuse its values for video.**
- **Storage** (`lib/blob.ts`)
  - Dual backend (Supabase Storage preferred, Vercel Blob fallback). `uploadPrivate()` / `presignPrivateGet(path, ttl)`. Both backends serve **HTTP range requests**, which video playback depends on.
- **Blur pipeline for video** (`lib/blur/pipeline-video.ts`, `composite-video.ts`)
  - keyframe detect (GroundingDINO) → box→point → SAM-2-video mask track → **ffmpeg composites one fully-blurred MP4 with all regions merged into a single mask**, audio preserved, `+faststart`. Runs out-of-band (Vercel function limits), not in a request handler.

**Implication:** the clean original and a fully-blurred derivative already exist for every video post. F1/F2 mostly need a **player on the client**. F3 needs the pipeline to additionally emit **per-region clean crops** and the data/payment layer to track **per-region unlocks**.

---

## 3. Recommended stack

### Player core: native `<video>` + a thin custom React layer (not a heavyweight player library)

**Recommendation: build on the raw HTML5 `<video>` element with a small custom control/overlay layer for v1.** Reasons specific to us:

- Our differentiator is the **blur-reveal overlay and per-region $ buttons positioned over moving content**. Off-the-shelf players (Video.js, Plyr) fight you the moment you need a custom layer above the video surface and a second video element composited on top. We'd spend the time theming around them.
- Clips are short, hackathon-scale, single-file MP4 — we don't need a player abstraction over adaptive streaming yet.
- We already own the reveal animation (`RevealMedia`) and the design system.

**If we later want a polished scrubber, captions, PiP, fullscreen, and HLS without building them:** adopt **[Vidstack](https://vidstack.io)** (`@vidstack/react`). It is React-19/Next-16 friendly, headless-by-default, exposes a real media store you can drive overlays from, and supports `requestVideoFrameCallback`. It's the upgrade path, not the v1.

**Avoid for now:** Video.js (jQuery-era ergonomics, heavy), Plyr (light but awkward to layer over), Mux Player / Cloudflare Stream player (great products but they assume *their* hosting/signing — we already have Supabase/Blob + our own gating).

### Delivery format: progressive **MP4 (H.264/AAC, `+faststart`)** over range requests — **not HLS yet**

- The pipeline already emits faststart MP4. Range-request progressive download gives us instant seek/scrub for short clips with zero extra infra.
- **HLS is deferred.** It's the right call for long-form or adaptive bitrate, but it multiplies our signing problem (every `.ts`/`.m4s` segment needs an authorized URL) and complicates the per-region overlay sync. Note it as future work behind a `useHls` flag if clips grow past ~2–3 min or we need ABR.
- Encode target: **H.264 High @ yuv420p, AAC, faststart, ≤1080p, CRF ~23**. yuv420p + H.264 is the only combination that plays everywhere including iOS Safari. (The pipeline already sets `-pix_fmt yuv420p` and `+faststart`.)

### Streaming auth: a **redirect route**, not direct signed URLs in `src`, and not a byte-proxy

This is the single most important infra decision for video and it fixes a real bug we'd otherwise hit (signed URL expiring mid-playback). See §7.

### Frame-accurate overlay sync: `requestVideoFrameCallback` (rVFC)

For F3 we composite a per-region clean video on top of the blurred base. rVFC (widely supported incl. modern iOS Safari) drives drift correction. Fallback to `timeupdate` where rVFC is missing.

---

## 4. Architecture at a glance

```
                         ┌──────────────── posts.accessMode ────────────────┐
                         │                                                    │
                  "full" (F1/F2)                                   "partial" (F3)
                         │                                                    │
   blurred base (free)   │   clean original (paid, whole)     blurred base (free)   per-region clean crops (paid each)
   posts.blurredPreviewUrl    posts.privateMediaKey            posts.blurredPreviewUrl   post_regions[].patchMediaKey
                         │                                                    │
              ┌──────────┴──────────┐                          ┌─────────────┴─────────────┐
              │  one /api/unlock     │                          │  /api/unlock/region        │
              │  → whole clip reveal │                          │  → reveal ONE region crop  │
              └──────────────────────┘                          └────────────────────────────┘
```

- **Full mode** keeps today's model exactly: free users see the blurred base; one payment swaps the source to the clean original with the blur-fade.
- **Partial mode** is new: the blurred base **streams for free**, and each `post_region` is an independently priced micro-unlock that overlays a clean crop of just that region.

---

## 5. F1 + F2 — Video playback with full-clip gate and blur-fade

### 5.1 Client

Today `PostCard` → `RevealMedia` renders `<Image>` only. Introduce a video branch.

- **New component `components/VideoStage.tsx`** (sibling to `RevealMedia`), selected by `PostCard` when `post.mediaType === "video"`.
  - **Base layer:** blurred preview `<video>` — `muted playsInline loop preload="metadata"`, `poster` = a blurred thumbnail. Autoplays muted (the only way iOS allows autoplay). CSS `filter: blur(14px) scale(1.06)` to match the image preview look.
  - **Revealed layer:** on unlock, mount the clean `<video>` and run the **same Framer Motion spring** as `RevealMedia` (`blur(15px)→0, scale 1.06→1, opacity 0→1`, 0.62s, crimson shimmer, reduced-motion = crossfade). The difference vs images: **carry playback position across the swap** — read `base.currentTime`, set it on the clean video, `play()` after `loadeddata`.
  - **Controls:** minimal custom layer — tap-to-play/pause, a thin progress bar, mute toggle, current time. Keep it gesture-light for a PWA feed. (Most feed videos can stay muted-autoplay-loop like Reels; full controls appear after unlock / on the post detail view.)
- **`PostCard`** lock overlay (the `Lock` + `UnlockButton`) stays as-is; it just sits over `VideoStage` instead of `RevealMedia`. `UnlockButton`/`useUnlock`/`/api/unlock` are unchanged.

### 5.2 Server

Mostly already there. Required changes:

- **Serve the free blurred base as a streamable video.** The feed already presigns `blurredPreviewUrl`. For video, presign it (longer TTL, e.g. 1h) or — better — point the base `<video src>` at the **public/stream redirect route** so range requests survive (§7). The base is blurred and safe to serve without payment.
- **Unlock response unchanged** — still returns a signed URL for `privateMediaKey`; the client points the revealed `<video>` at the **stream redirect route** (§7) so a paused-then-seek after the 300s TTL doesn't 403.
- **Thumbnails/poster:** add a pipeline step to extract a blurred poster frame (ffmpeg `-frames:v 1`) so the base `<video>` has a `poster` and the feed isn't black before metadata loads. Store its pathname (optional column `posts.posterKey`, or derive a deterministic path).

### 5.3 Upload

`app/api/posts/route.ts` already detects `video/*` and routes into the blur pipeline. Confirm/raise the **25 MB upload cap** for video (images don't need it; short video will). Add server-side validation of duration/codec, and reject anything that isn't H.264/AAC MP4 (or transcode it — see pitfalls §8).

---

## 6. F3 — Partial reveal (per-region micro-unlocks)

This is the hard part. The clip plays free, blurred regions each have a `$X` button, tapping pays for and reveals **only that region** while the rest stays blurred.

### 6.1 The core security constraint

We can **never** hand the client the clean full-frame video for a partial post — that would leak the unpaid regions. So a region reveal must deliver **only the pixels of the paid region**. Two viable architectures:

#### Option A — Per-region clean crops, composited on the client (RECOMMENDED)

Pipeline emits, for each region, a **clean video cropped to that region's bounding box** (the union of its per-frame boxes across the clip → one static rect). On unlock we stream that crop and overlay it, absolutely positioned, on top of the blurred base, synced frame-for-frame.

- **Pro:** instant "magic" reveal (no re-encode on tap); server only ever releases pixels the user paid for; cheap per unlock.
- **Con:** multiple `<video>` elements playing at once → **iOS decoder limits** and **A/V drift** to manage (§8). Mitigated by capping regions and lazy-mounting crops only after unlock.

#### Option B — Server recomposites on each unlock

On unlock, ffmpeg produces a new derivative with the paid region(s) un-blurred and returns a fresh signed URL; client swaps source and seeks back to the saved time.

- **Pro:** always exactly one `<video>`; no client sync; trivially secure.
- **Con:** seconds of latency per tap (kills the instant reveal), real GPU/CPU cost per unlock, source swap is visible. Combinatorial if regions unlock in any order (cache by unlocked-set).

**Decision: Option A** (confirmed by the §1.1 scope lock). With ~2 regions on an 8s clip we have at most **3 concurrent decoders** and trivial sync — the decoder ceiling that would have motivated Option B doesn't bind here. Cap priced regions at **2–3** (also better UX). Option B (server recomposite) is **dropped** for the hackathon; revisit only if we ever go to many-region or long-form clips.

### 6.2 Data model changes

```ts
// lib/db/schema.ts (additions)

// Distinguishes the two gating models. Existing posts default to "full".
export const accessModeEnum = pgEnum("access_mode", ["full", "partial"]);
// posts: add
//   accessMode: accessModeEnum("access_mode").notNull().default("full"),
//   posterKey:  text("poster_key"),            // blurred poster frame (optional)
//   durationMs: integer("duration_ms"),         // for the scrubber / preloading

// One row per independently-priced blurred region on a partial post.
export const postRegions = pgTable("post_regions", {
  id: uuid("id").defaultRandom().primaryKey(),
  postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  label: varchar("label", { length: 64 }).notNull(),        // "breast", etc. (never shown raw to fans)
  // Union bbox across all frames, normalized 0..1 so it scales to any rendered size.
  rect: jsonb("rect").$type<{ x: number; y: number; w: number; h: number }>().notNull(),
  // Optional per-frame trajectory for a region that moves a lot (v2 "follow" mode).
  track: jsonb("track").$type<{ frame: number; box: [number, number, number, number] }[]>(),
  // Private clean crop of just this region (Option A). Presigned on unlock.
  patchMediaKey: text("patch_media_key").notNull(),
  // NOTE: no per-region price. The creator sets ONE price on the post
  // (`posts.unlockPrice`) and every region costs that same amount to reveal.
  position: integer("position").notNull().default(0),       // button stacking / order
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("post_regions_post_idx").on(t.postId)]);

// Per-region equivalent of `unlocks`. Separate table because `unlocks` is unique
// on (fanId, postId) and must keep meaning "owns the whole post".
export const regionUnlocks = pgTable("region_unlocks", {
  id: uuid("id").defaultRandom().primaryKey(),
  fanId: uuid("fan_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  postRegionId: uuid("post_region_id").notNull().references(() => postRegions.id, { onDelete: "cascade" }),
  paymentTxHash: varchar("payment_tx_hash", { length: 66 }).notNull(),
  amountPaid: decimal("amount_paid", { precision: 18, scale: 8 }).notNull(),
  settlementMs: integer("settlement_ms"),
  unlockedAt: timestamp("unlocked_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("region_unlocks_fan_region_uniq").on(t.fanId, t.postRegionId), // one per fan per region
  index("region_unlocks_fan_idx").on(t.fanId),
]);
```

Migrations: add via Drizzle (`drizzle-kit generate`) — append-only, no destructive changes to existing tables. `posts.accessMode` defaults to `"full"` so every current post is untouched.

### 6.3 Pipeline changes (out-of-band worker, not a request handler)

Extend `lib/blur/pipeline-video.ts`. We already have `regions` (with per-frame boxes) and the clean source. Add a step after the existing composite:

1. **Cluster** per-frame detections into **N stable regions** (merge boxes of the same tracked object id across frames — SAM-2 already gives us object ids via `regionsToSam2Clicks` in `lib/blur/geometry.ts`).
2. For each region, compute the **union bbox** across its frames, pad it (~8%), snap to even pixels (yuv420p needs even dims), clamp to frame.
3. ffmpeg **crop** the clean source to that rect for the clip's duration → `region-<i>.mp4` (faststart, yuv420p, audio dropped — a crop doesn't need audio; audio rides the base). Upload private → `patchMediaKey`.
4. Persist `post_regions` rows at publish time (`publishJob` in `lib/blur/jobs.ts` gains a partial branch) with the normalized `rect`, label, and a default/creator-set `unlockPrice`.

Creator chooses, at review time, **full vs partial** and sets a price per region (default split of the post price, editable). The review UI already renders detected regions for approval — extend it to assign prices.

### 6.4 Per-region unlock API + payment

- **New route `app/api/unlock/region/route.ts`** — POST `{ postId, regionId }`.
  - Mirror `app/api/unlock/route.ts`: `requireCurrentAppUser()` → load `post_region` (verify it belongs to `postId`) → `unlockRegionWithCustodialBalance()` (new, mirrors `unlockWithCustodialBalance` but writes `region_unlocks` and keys idempotency on `(fanId, postRegionId)`) → `settleUnlockWithCustodialWallet({ amountUsd: post.unlockPrice, reference })` (the **single post price** is charged per region) → return a **stream-route URL** for `patchMediaKey` (TTL 300, video).
  - Reuse `settleUnlockWithCustodialWallet` as-is (it's per-amount, reference-keyed). Add `unlockRegionWithCustodialBalance` / `rollbackCustodialRegionUnlock` / `finalize…` in `lib/custodial.ts` paralleling the post versions.
- **Loyalty:** region unlocks award points too (reuse `POINTS_PER_UNLOCK` or a smaller per-region value).

### 6.5 Client — the partial player

**New `components/PartialVideoStage.tsx`:**

- **Base:** blurred `<video>` (free), the master clock. `muted playsInline loop` (loop optional — for partial we likely want real controls, not loop).
- **Region gates:** for each locked `post_region`, an absolutely-positioned button at `rect` (scaled from normalized 0..1 to the rendered video box) showing `$0.05` with a small lock glyph. Tap → `POST /api/unlock/region`.
- **Region patches:** on unlock, mount a `<video>` for that region's crop, absolutely positioned at the same `rect`, `muted playsInline`, **driven by the base clock**:
  - On base `play`/`pause`/`seeking`/`ratechange`, mirror to every patch.
  - A `requestVideoFrameCallback` loop on the base corrects each patch's `currentTime` if `|drift| > 50ms`.
  - Run the blur-fade spring **on that patch only** (the region's blur fades to reveal the crop). Rest of the base stays blurred.
- **Server still owns gating:** the patch `<video src>` is the stream redirect route, which 302s only if the caller holds a `region_unlocks` row.

**Sync helper** `useMediaSync(baseRef, patchRefs)` — encapsulates the play/pause/seek mirroring + rVFC drift correction so the stage component stays declarative.

### 6.6 Edge cases for partial mode

- **Region moves out of its union bbox** → with a static union rect the crop always contains it, at the cost of a slightly larger reveal window. Acceptable v1. v2: use the `track` trajectory to animate the patch's position per frame (rVFC already gives us the frame hook).
- **Overlapping regions** → order by `position`; later (higher) draws on top.
- **All regions unlocked** → optionally swap to the full clean source (we now know they paid for everything) to drop the extra decoders. Only do this if total paid ≥ sum, and re-gate is impossible (they own all rows).
- **Creator sets a post to partial but only one region** → fine, it's just F3 with one button.

---

## 7. Streaming, signing & range requests

> **Scope note:** at ≤8s clips this is a *robustness* improvement, not a demo blocker (see §1.1). An 8s file buffers in the first range request and loops from memory, well inside the 300s TTL — direct presigned URLs work for the demo. Build the redirect route if time allows or before any longer-form content; otherwise ship direct presigned URLs from `/api/unlock` (full) and the feed query (base), and a presigned URL from `/api/unlock/region` (patch).

**Problem (general case):** a signed URL with a 300s TTL placed directly in `<video src>` breaks when the user pauses >5 min and then seeks — the browser opens a *new* range request to an expired URL → 403, playback dies. Proxying the bytes through a Next route handler fixes auth but burns our function bandwidth/time on every video.

**Solution — a thin redirect route** (`app/api/media/[postId]/route.ts`, and `[postId]/[regionId]`):

```
GET /api/media/<postId>            (full clean, requires unlock row)
GET /api/media/<postId>?base=1     (blurred base, free)
GET /api/media/<postId>/<regionId> (region crop, requires region_unlocks row)
```

- Authorize **on every call** against Clerk identity + the relevant unlock row (this keeps gating server-side — the redirect is not a bypass).
- Then `307` redirect to a **freshly presigned** storage URL. The browser re-issues its `Range` request to storage directly (no bytes through us). Because we re-sign per connection, expiry mid-playback self-heals on the next range request.
- `runtime = "nodejs"` (signing + Postgres), and these GETs must be **cookie-aware** (the existing `setAccountCookie` / `requireCurrentAppUser` path).

Notes:
- Supabase Storage and Vercel Blob both honor `Range` and return `206` + `Accept-Ranges: bytes` — required for seek and for iOS (which *only* starts playback after a successful range probe).
- Set `crossorigin="anonymous"` on every `<video>` and ensure CORS headers on the storage origin **if** we ever draw frames to `<canvas>` (thumbnails, future canvas compositor) — otherwise the canvas is tainted and unreadable.
- Cache-Control: base/poster can be cached (`public, max-age` short); per-user gated crops must be `private, no-store`.

---

## 8. Common pitfalls & best practices

**Mobile / iOS Safari (this is a PWA — assume iPhone first):**
- **Autoplay requires `muted` + `playsInline`.** Without `playsInline`, iOS hijacks into native fullscreen on play. Without `muted`, autoplay is blocked entirely. Feed previews must be muted-autoplay; sound only after a user gesture.
- **Concurrent video decoders are limited** on iOS (a handful, device-dependent, and memory-pressured). At our scope (1 base + 2 patches = 3) this is comfortably fine, but the discipline still matters as the feed scrolls: **lazy-mount a patch `<video>` only after its unlock**, and **release decoders for off-screen feed items** (`src=""` / unmount + pause on scroll-away via IntersectionObserver) so a long feed of videos doesn't accumulate live decoders.
- **Low Power Mode** pauses/blocks autoplay — show the poster + a play affordance, never assume autoplay succeeded (`play()` returns a promise; handle rejection).

**A/V sync (F3):**
- Independent `<video>` elements drift. Designate the **base as the single clock**; mirror transport events and correct patches via `requestVideoFrameCallback` (fallback `timeupdate`). Re-sync on `seeked`, `ratechange`, tab `visibilitychange` (background tabs throttle timers).
- Keep patches **muted**; only the base carries audio (avoids echo and an extra audio decode).

**Signed URLs / streaming:**
- Don't embed raw signed URLs in `src` for anything longer than the TTL — use the redirect route (§7).
- Don't proxy bytes through a serverless function (timeout + egress). Redirect instead.
- Ensure `Accept-Ranges`/`206` works end-to-end before debugging "video won't seek on iPhone."

**Encoding / format:**
- Standardize on **H.264 High + AAC + yuv420p + faststart**. yuv444/422, HEVC-only, or AV1 will silently fail on some targets. Validate (or transcode) **on upload**, not on play — a clip that won't decode should never reach the feed. ffmpeg `-pix_fmt yuv420p -movflags +faststart` (the pipeline already does this for derivatives; apply to ingest too).
- Even pixel dimensions for every crop (yuv420p requirement) — pad/snap union bboxes.

**Layout / perf:**
- Reserve the media box with `aspect-ratio` (the image path already uses `4/5`) to avoid CLS when video metadata loads.
- `preload="metadata"` (not `auto`) for feed items; `preload="auto"` only for the focused/playing item. Pause + unload off-screen videos (IntersectionObserver) to save battery and decoders.
- Don't ship the clean original as the poster — generate a **blurred** poster, or you leak frame 1.

**Security / gating (don't regress the core promise):**
- The redirect route authorizes **every** request; the blurred base is the only thing served without an unlock row.
- For partial posts, never deliver the full clean source until *all* regions are owned. Region crops must be tight (the union bbox is the smallest safe rect).
- Keep region `label`s ("breast" etc.) server-side; never render the raw label to fans.

**Idempotency / payments:**
- Region unlocks reuse the custodial escrow→settle→finalize→rollback choreography. Key idempotency on `(fanId, postRegionId)` exactly as posts key on `(fanId, postId)`. A double-tap must not double-charge.

---

## 9. Phased rollout

> **Build status (updated):** the entire app-layer slice for F1/F2/F3 is implemented and
> typechecks. The only remaining gap is **content creation** — generating per-region clean
> crops and creating a `partial` post (the out-of-band pipeline work, currently a PoC and
> Replicate-credit blocked). See "Remaining" below.

**Phase 0 — Foundations (shared)**
- [x] Schema carries `posts.posterKey` + `durationMs`; feed presigns the poster.
- [ ] Raise/branch upload size limit + codec validation for video in `app/api/posts/route.ts`.
- [ ] *(optional, see §7)* `/api/media/[postId]` redirect/stream route — robustness for if/when clips get longer; not required for ≤8s demo. (Direct presigned URLs in use for now.)

**Phase 1 — F1 + F2: full-gate video** ✅
- [x] `components/VideoStage.tsx` (base blurred `<video>` + reveal spring + mute/pause controls + in-view autoplay).
- [x] `PostCard` branches to `VideoStage` when `mediaType === "video"`; carries playback position across the unlock swap; pauses the teaser once revealed.
- [x] Base teaser + revealed clip use presigned URLs (feed presign + `/api/unlock`).
- [ ] Verify range/seek + autoplay-muted on a real iOS Safari (needs seeded video).

**Phase 2 — F3 data + payments** (data/payments ✅, pipeline ⏳)
- [x] Schema: `accessMode`, `post_regions`, `region_unlocks` (migration `0003_melted_pretty_boy.sql`).
- [x] `lib/custodial.ts`: `unlockRegionWithCustodialBalance` / rollback / finalize.
- [x] `app/api/unlock/region/route.ts`.
- [x] `getPostRegion` / `getPostRegionsWithUnlocks` queries; feed presigns owned crops.
- [x] **Pipeline: `onTrackComplete` clusters regions → padded even-snapped crop → ffmpeg `cropVideoRegion` → upload → `blur_jobs.regionPatches` (migration `0004`).**
- [x] **`publishJob` partial branch: writes `post_regions` + sets `accessMode = "partial"` when the creator picks partial and crops exist.**
- [x] **Creator review UI toggle (`ReviewPanel`): "Lock whole clip" vs "Reveal per area"; approve route forwards `accessMode`.**

**Phase 3 — F3 player** ✅
- [x] `components/PartialVideoStage.tsx` + `components/useMediaSync.ts` (base clock + rVFC drift correction).
- [x] `components/useRegionUnlock.ts`; positioned region $ buttons via the object-cover transform; per-region blur-fade on reveal.
- [ ] Quick smoke test on one real iPhone (1 base + 2 patches). Expected fine at this scale.

**Phase 4 — Polish / future**
- [ ] Per-frame region "follow" (use `track`), all-regions-owned → swap to full source, captions/scrubber via Vidstack, HLS for long-form.

### Content creation — now wired into the real pipeline ✅

The detect → track → composite pipeline now also produces partial posts end-to-end:

- `lib/blur/state.ts` `onTrackComplete` → `buildRegionPatches()`: clusters the frame-0 detection boxes (`lib/blur/geometry.ts` `clusterBoxes`), pads + even-snaps each (`padClampEven`), ffmpeg-crops the clean source (`lib/blur/composite-video.ts` `cropVideoRegion`), uploads, and stores `{ label, rect, patchKey }[]` on `blur_jobs.regionPatches`. Non-fatal — a crop failure still lets the post publish as full.
- The creator picks **Lock whole clip** vs **Reveal per area** in `ReviewPanel`; `publishJob` writes `post_regions` + flips `accessMode` accordingly.

**Known limits (acceptable at ~2-region / 8s scope):**
- Crop boxes are seeded from **frame-0 detections** + generous padding (`BLUR_REGION_PAD`, default 0.18). A region that drifts far over the clip could leave its crop window. v2: derive the union bbox from the SAM-2 mask track (`track` jsonb).
- Crops are **rectangular**, so two regions whose padded boxes overlap could let one reveal expose the other. Fine for separated regions; otherwise re-blur the neighbour inside the crop.
- The single-Cog path (`onCogComplete`) doesn't emit boxes, so partial isn't available there until the Cog returns per-region boxes.

Tunables: `BLUR_MAX_REGIONS` (default 3), `BLUR_REGION_PAD` (default 0.18).

---

## 10. Decisions

1. ~~Clip length & scale~~ — **Resolved: ≤7–8s short clips. Progressive MP4, no HLS.**
2. ~~F3 priority~~ — **Resolved: F3 (partial, ~2 regions) is in demo scope alongside full-gate video.**
3. ~~Decoder reality check~~ — **Resolved: at 3 decoders (1 base + 2 patches) this is not a concern; Option A confirmed, no Option B fallback.** Still worth a quick smoke test on one real iPhone during Phase 3, but it no longer gates the architecture.
4. ~~Region pricing UX~~ — **Resolved: the creator sets ONE price on the post; every region costs that same amount.** No per-region price column; reuse `posts.unlockPrice`.

---

### File-by-file change map (quick reference)

| Area | File | Change |
|------|------|--------|
| Schema | `lib/db/schema.ts` | `accessModeEnum`, `posts.accessMode/posterKey/durationMs`, `postRegions`, `regionUnlocks` |
| Stream | `app/api/media/[postId]/route.ts` *(new)* | Authorized presign-redirect for base/full/region |
| Player F1/F2 | `components/VideoStage.tsx` *(new)*, `components/PostCard.tsx` | Video branch + reveal spring reuse |
| Unlock F3 | `app/api/unlock/region/route.ts` *(new)*, `lib/custodial.ts` | Per-region escrow/settle/finalize/rollback |
| Player F3 | `components/PartialVideoStage.tsx` *(new)*, `components/useMediaSync.ts` *(new)* | Overlay crops + base-clock sync |
| Pipeline | `lib/blur/pipeline-video.ts`, `lib/blur/jobs.ts` | Region clustering → crops, partial publish branch |
| Upload | `app/api/posts/route.ts` | Size limit + codec validation for video |
