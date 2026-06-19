# Handover — Tempo Onlyfans (`Veil.dc.html`)

Continue addressing **Kerem's 6 review comments**. The login rework is done and shipped. This doc captures what's already done and exactly what's left so you can pick up in a new chat.

> File: `Veil.dc.html` (single Design Component, ~530 lines). Codebase reference: local folder `mpp-onlyfans/` (re-grant access if prompted). Frame size is 390×844.

---

## ✅ Already done

**Logic foundation is in place** (lines ~388–430). Do NOT re-add these — just wire the template to them.

- `state` now includes: `notifFilter:'All'`, `reviewStage:'idle'`, `reviewType:'image'`, `search:''` (line 390).
- `onSearch(e)` — search input handler.
- **Blur-review pipeline** (mirrors the codebase `lib/blur` state machine in `components/blur/`):
  - `onMedia(e)` — reads picked file, detects image vs video, calls `startReview`, clears the input.
  - `startReview(mediaType)` — token-guarded; sets `screen:'review'`; advances `reviewStage` through stages every 1350ms. Image stages: `detecting → compositing → ready_for_review`. Video stages: `detecting → tracking → compositing → ready_for_review`. Haptics via `navigator.vibrate`.
  - `approveReview()` — `reviewStage:'publishing'` → after 900ms `'published'`.
  - `rerunReview()` — restarts the pipeline.

These methods are **not yet referenced by the template**, so the design renders clean. Verified no console errors.

---

## ⬜ Remaining work (in order)

### Todo 2 — `renderVals` outputs
Expose values the new template markup needs (compute in `renderVals()`, never as JSX expressions in holes):
- `notifFilter` + per-chip active styles (or a small helper) so filter chips highlight the selected one.
- Gallery tiles array for the profile post grid (todo 4) — `<sc-for>` over ~9–12 placeholder tiles.
- Review screen values: current stage label/copy, stepper step states (done/active/pending), detected-region overlay boxes + confidence chips, and the right button set per stage. Reference `components/blur/BlurProgress.tsx` (ordered pipeline stages, image skips `tracking`) and `components/blur/ReviewPanel.tsx` (approve / re-run / manual, nothing public until approved).
- Add `search` screen + `review` screen to `navDisp` hide-list (currently line 528: `(s === 'onboarding' || s === 'dm') ? 'none' : 'flex'` — add `'review'`, and decide for `'search'`).

### Todo 3 — #1 Align Unread number + text
**Anchor `c291a54c4a-span`** → it's the Messages filter pill at **line 236** (`data-comment-anchor="c29...`, the "Unread" pill with a count). The number and label are vertically misaligned. Fix with `display:flex; align-items:center; line-height:1` on the pill / its children. (Note: the anchor in the comment is `c291a54c4a-span`; the file shows `c29…` truncated at line 236.)

### Todo 4 — #2 Clickable notification filter chips
**Anchor `2d10178639-span`** → **line 179**, the notification filter row (lines 178–181: `All / Unveils / Tips / Mentions`). Currently static `<span>`s. Convert to `<button>`s wired to set `notifFilter`, and drive the active pill style from state (active = `var(--tint)` bg + `rgba(194,20,59,.35)` border + `var(--text)`; inactive = `var(--surface-2)` + `var(--muted)`). The "All" chip on the Messages screen (line 235) and notif screen are the visual reference.

### Todo 5 — #3 Search screen
**Anchor `1bf659765a-circle`** → the search icon (magnifier) in a header — wire its button `onClick` to `go('search')`. Build a new `search` screen block (follow the existing screen pattern — each screen is a conditional block; check how `feed/notif/msg/profile/new` screens are gated). Include: a top search input bound to `onSearch`/`state.search`, recent/suggested chips, and a results grid or creator list. Keep bottom nav visible (or not — your call via `navDisp`).

### Todo 6 — #4 Profile post grid (replace subscription card)
**Anchor `90c6f61427-div`** → **line 284**, currently a subscription/benefits row inside the profile stats list (lines 283–285). Replace the subscription card with an **Instagram-style 3-column post grid** (`display:grid; grid-template-columns:repeat(3,1fr); gap:2px`), tiles ~`aspect-ratio:1/1`, some marked locked/blurred (ties into the blur theme). Use placeholder tiles from a `renderVals` array via `<sc-for>`. (Profile header/avatar is at lines 262–266; `df35eacfcf-div` is the name block — leave it.)

### Todo 7 — #5 Center Publish button text
**Anchor `93fa731f7a-button`** → the **Publish** button (New-post screen header, button at line 204, the `New post` header is lines 202–205). Text isn't centered. Add `display:flex; align-items:center; justify-content:center` to the button.

### Todo 8 — #6 File picker → revamped blur-review screen (the big one)
**Anchor `395ea274d3-div`** → **line 211**, the New-post "add media · auto-blur on" dropzone (lines 211–213, dashed box with image icon).
1. **File selector:** make the dropzone trigger a native file picker. Add a hidden `<input type="file" accept="image/*,video/*">` with `onChange="{{ onMedia }}"` and a ref; the dropzone click opens it. (`onMedia` already exists and routes into `startReview`.)
2. **Revamp the review screen** — completely rebuild it to be **elaborate, dynamic, keeps the user in the loop**:
   - Live **stepper/progress** reflecting `reviewStage` (detecting → [tracking, video only] → compositing → ready_for_review → publishing → published). Animate the active step. Reference `components/blur/BlurProgress.tsx`.
   - Blurred media preview with **detected-region overlay boxes + confidence chips** while processing; reveal "ready" state with approve/re-run/manual controls. Reference `components/blur/ReviewPanel.tsx` (nothing goes public until **Approve**).
   - Wire buttons: Approve → `approveReview`, Re-run → `rerunReview`.
   - **Add a back button** in this screen (top-left) that returns to the New-post screen (`go('new')` and reset `reviewStage:'idle'`).
   - Hide bottom nav on `review` (add to `navDisp` none-list).

### Todo 9 — Routing + verify
- Make sure `screen` routing renders the new `search` and `review` blocks.
- Update `navDisp` for both.
- Run `ready_for_verification({path:'Veil.dc.html'})`; fix any console errors; let the verifier check it.

---

## Key reference points (line numbers approximate — re-grep before editing)
| What | Line | Anchor |
|---|---|---|
| Notif filter chips (All/Unveils/Tips/Mentions) | 178–181 | `2d10178639-span` |
| New-post header + Publish button | 202–205 | `93fa731f7a-button` |
| Add-media dropzone | 211–213 | `395ea274d3-div` |
| Messages "Unread" pill | 235–236 | `c291a54c4a-span` |
| Profile subscription card → grid | 283–285 | `90c6f61427-div` |
| Bottom nav (`navDisp`) | 338 | — |
| Logic class start | 389 | — |
| `navDisp` computation | 528 | — |

## Editing conventions for this DC
- Template edits: `dc_html_str_replace`. Logic edits: `dc_js_str_replace`. Both already used successfully here.
- **Inline styles only** — no CSS classes/stylesheets. Match existing CSS vars: `--primary`, `--tint`, `--text`, `--muted`, `--faint`, `--surface`, `--surface-2`, `--hairline`, `--hairline-2`, `--success`. Primary brand red ≈ `rgb(194,20,59)`.
- No JS in `{{ }}` holes — compute in `renderVals()` and expose by name. Use `<sc-for>`/`<sc-if>` with `hint-*` for lists/conditionals.
- Keep `data-comment-anchor` attributes on the semantically-equivalent element when restructuring.
- Preserve the 390×844 frame and `$preview` size.
