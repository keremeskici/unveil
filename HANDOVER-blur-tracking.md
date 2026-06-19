# Handover — Tracking tap-button + full blur-upload run

> Context handoff for continuing in a fresh agent. Everything below is **uncommitted working-tree state** unless noted. Date: 2026-06-19.

## The task (user's words)

1. Push `/Users/kerem/Downloads/saced.mp4` as a post **through the full flow from an account**.
2. In the video player, **the blurred area should have a button on it that tracks the blurred part**, and clicking it should **go through the exact same unblurring (unlock) process**.

## Decisions locked in (the user answered these)

- **Run target:** Local, real pipeline (real Replicate spend, dev-auth account, drive stages via polling).
- **Clip content:** Trust auto-detection (the clip does contain detector-targeted regions).
- **Tracking depth:** *Button follows the region* — persist a per-frame box track from the SAM2 mask and animate the tap-button to it; on unlock, reveal the existing secure server-side crop (NOT a fully-tracked tight per-frame reveal). Same unlock flow, gating stays secure.

## Background: how blur works in this repo (already existed before this task)

- Auto-blur pipeline (`lib/blur/*`, `app/api/blur/*`) is feature-complete and merged. Upload → `blur_jobs` row → detect (grounding-dino) → track (SAM2 video) → composite (ffmpeg, inline) → `ready_for_review` → creator approve → `publishJob` creates the public `posts` row.
- Fan side: full-gate posts use `RevealMedia`; **partial** posts use `PartialVideoStage` — the blurred clip plays free, each detected region is an independent `$`-priced micro-unlock (`/api/unlock/region` → signed clean crop). This partial system already existed; the button was just **static** (frame-0 box, padded). The task was to make it **track** the moving region.
- Env is fully configured in `.env.local`: `REPLICATE_API_TOKEN`, `REPLICATE_GROUNDING_DINO_VERSION`, `REPLICATE_GROUNDED_SAM_VERSION`, `REPLICATE_SAM2_VIDEO_VERSION`, `REPLICATE_SAMURAI_VERSION`, Supabase blob, Postgres, Clerk, `CRON_SECRET`, `NEXT_PUBLIC_APP_URL=http://localhost:3000`.
- **Dev auth bypass:** cookie `veil_dev_auth=default` authenticates as the dev user when `NODE_ENV=development` (`lib/dev-session.ts`, `app/api/dev/login`). Used for the upload + approve as "an account."

## Code changes made (Phase 1 — the tracking feature)

All implemented + typecheck-clean for touched files (`npx tsc --noEmit` showed no errors in them). **Not committed.**

1. **`lib/db/schema.ts`**
   - Added `export type RegionTrackPoint = { t: number; rect: RegionRect }`.
   - Added `track` jsonb column to `postRegions` (`$type<RegionTrackPoint[]>()`, nullable).
   - Added optional `track?` to the `RegionPatch` type.

2. **`lib/blur/track-extract.ts`** (NEW)
   - `extractMaskTracks(maskPath, clips: RegionRect[]): Promise<RegionTrackPoint[][]>`.
   - ffmpeg-extracts downscaled grayscale frames of the SAM2 mask video at 10fps, scans each frame for the white-pixel bounding box **restricted to each region's union box** (`clips`), returns one normalized track per clip. (Combined SAM2 mask can't be split per-object, so pixels are attributed to a region by which union box they fall in.)

3. **`lib/blur/state.ts`**
   - `buildRegionPatches(job, srcPath, maskPath, work)` — now takes `maskPath`; after building patches it calls `extractMaskTracks(maskPath, patches.map(p=>p.rect))` and attaches `tracks[i]` to each patch.
   - **BUG FIX (important):** added `webhookFields(jobId, stage)` helper that **omits the Replicate webhook when the resolved base URL isn't HTTPS** (localhost). Replicate 422s at prediction-create on a non-HTTPS webhook URL, which previously made the pipeline unable to even start locally. All 4 create call-sites (`cogStage`, image `detectStage`, video `detectStage`, `trackStage`) now spread `...webhookFields(...)` instead of always passing `webhook`/`webhook_events_filter`. Prod (https) is unaffected; local relies on polling/reconcile.

4. **`lib/blur/jobs.ts`** — `publishJob` now inserts `track: p.track ?? null` into `post_regions`.

5. **`lib/db/queries.ts`** — `getPostRegionsWithUnlocks` now returns `track: r.track` (unconditional — the track is not sensitive; it just mirrors where the visible blur moves).

6. **`app/page.tsx`** — partial-region mapping now threads `track: r.track ?? null` into the `PartialRegion`.

7. **`components/PartialVideoStage.tsx`** — the core feature:
   - `PartialRegion` gained `track?: TrackPoint[] | null`.
   - A rAF loop interpolates each locked region's track at the base video's `currentTime` and **moves the gate button's wrapper imperatively** (no per-frame React re-render), via the same object-cover transform used for the static patches. Falls back to the static union rect when there's no track.
   - `RegionGate` no longer positions itself (wrapper owns position); tracked regions get a solid ring vs the legacy dashed ring. Clicking still calls `useRegionUnlock` → `/api/unlock/region` (unchanged unlock flow). Revealed crop still sits on the static union rect (per chosen scope).

8. **`scripts/dev-blur-drive.ts`** (NEW) — DEV-ONLY webhook stand-in. Polls Replicate predictions and calls the production `advance()` to walk detect→track→composite, because localhost can't receive Replicate webhooks. Re-kicks orphaned `uploaded` jobs. Run: `npx dotenv -e .env.local -- tsx scripts/dev-blur-drive.ts <jobId>`.

## DB migration

- Ran `npm run db:push` → the `post_regions.track` column was applied to the live DB ("Changes applied"). Done.

## Phase 2 — the live run (COMPLETED)

- Dev server already running on **localhost:3000** (preview server, serverId `8b580d14-c74e-426c-90dc-cd19982b68a4`).
- Uploaded `saced.mp4` (1280×720, 4.45s) via real HTTP `POST /api/posts` with `Cookie: veil_dev_auth=default`, title "Behind the veil", price 0.50.
  - **jobId: `e21b3b6a-c292-4bdf-a8ae-087f17059b3c`**
- Drove stages with `scripts/dev-blur-drive.ts` (real Replicate): detect found **4 regions** (breast×2, buttocks×2) → clustered to **3 patches** → SAM2 track → ffmpeg composite → `ready_for_review`.
- Initially the tracks weren't attached (old code only tracked single-region jobs). Fixed `extractMaskTracks` to handle multiple regions, then **re-ran only the composite step from the existing SAM2 prediction (no new GPU spend)** via a one-shot `advance(jobId, 'track', {output})`. Result: all **3 patches now carry 44-point tracks**.
- Approved as **partial** via `POST /api/blur/jobs/<jobId>/approve` `{"accessMode":"partial"}` (dev cookie).
  - **Published postId: `faf412aa-2767-4289-8508-0d2079506e5c`** — `accessMode=partial`, 3 regions, each with a 44-pt `track` + clean crop, `isPublished=true`.

## Verification status

- ✅ **Numeric:** simulated the player math against the real published tracks — the button box clearly moves over time (e.g. bottom "buttocks" region left edge moves −9→−14→−3→3→27 px across t=0–4s in a 412px card; "breast" width breathes 449→518→465). Geometry maps correctly into the card.
- ✅ **Server render:** authed feed HTML renders the "Behind the veil" post, no server errors.
- ❌ **Live browser visual:** NOT captured. The Claude preview browser tab sits at `chrome-error://chromewebdata/` and cannot reach the proxied dev server (the app is served through a proxy, not raw `localhost`; `document.cookie` is sandbox-blocked). The user's OWN browser session is live in the server logs — **do not restart the dev server under them.**
- ⏳ **Was mid-flight when interrupted:** building a `show_widget` visual that embeds the real (downscaled, base64) blurred clip + real tracks to replicate the player and prove the tracking button moves. Assets were prepped at `/tmp/veil-demo2.mp4` (9.6KB), `/tmp/veil-tracks-min.json`. This is optional/cosmetic proof — the feature itself is verified by data + numeric check.

## What's left / open items for the next agent

1. **Get a real visual confirmation** of the tracking button + a successful click-unlock. Options:
   - Finish the `show_widget` replica (assets in `/tmp`), OR
   - Help the user view it themselves: the post is in the feed **for a different account** (the feed excludes the viewer's own posts via `getFeed(..., fan.id)`), or on the dev creator's profile. The post creator is the dev user.
2. **Click-unlock not yet exercised end-to-end.** `/api/unlock/region` charges the fan's custodial balance ($0.50/region). The dev user may have **zero balance** → expect a 402 "Insufficient balance". To demo a successful reveal, credit the dev user's custodial balance first (see `lib/custodial.ts` / custodial ledger). The unlock *flow* is unchanged and correct; only funding is untested.
3. **Tracking fidelity caveats** (acceptable per chosen scope, but note them):
   - The "breast" region is full-height/half-width (large detection) → its button is big and its motion is subtle. The two "buttocks" regions track more visibly.
   - Multi-region tracks are approximate: the combined SAM2 mask is attributed per region by union box, and these regions overlap in x, so their x-tracks look similar. Fine for distinct y-bands.
4. **Not committed, not full-built.** Run `npx tsc --noEmit` / `npm run build` before shipping. Consider whether the `webhookFields` https-gating change and the tracking feature should be one commit or split. Branch is `main` — branch before committing per repo convention.
5. **Cleanup:** `scripts/dev-blur-drive.ts` is dev-only (fine to keep, it's guarded by usage). Temp files in `/tmp/veil-*`.

## Handy commands / identifiers

```
# dev server: localhost:3000 (running). Dev auth: Cookie: veil_dev_auth=default
jobId   = e21b3b6a-c292-4bdf-a8ae-087f17059b3c
postId  = faf412aa-2767-4289-8508-0d2079506e5c   (partial, 3 tracked regions)

# inspect the published post + tracks
npx dotenv -e .env.local -- tsx -e '...query posts/postRegions by id...'

# re-drive a job's stages locally (webhook stand-in)
npx dotenv -e .env.local -- tsx scripts/dev-blur-drive.ts <jobId>

# upload another clip as the dev account
curl -s -X POST http://localhost:3000/api/posts -H "Cookie: veil_dev_auth=default" \
  -F "file=@/path/to.mp4;type=video/mp4" -F "title=..." -F "price=0.50"

# approve as partial
curl -s -X POST http://localhost:3000/api/blur/jobs/<jobId>/approve \
  -H "Cookie: veil_dev_auth=default" -H "Content-Type: application/json" -d '{"accessMode":"partial"}'
```

## Memory note

Project memory lives at `/Users/kerem/.claude/projects/-Users-kerem-mpp-onlyfans/memory/` (see `MEMORY.md`). Consider adding a memory entry for the per-frame region-tracking feature and the localhost-webhook https-gating fix once committed.
