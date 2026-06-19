# Handover — DM pay-per-view (PPV) card + composer work

Context for continuing this work in a fresh agent. Project: **mpp-onlyfans / "Unveil"** — a pay-per-tap blur-to-reveal (OnlyFans-style) PWA on Tempo (hackathon). Next.js App Router, Clerk auth, Drizzle/Postgres, Vercel Blob for private media. Branch: `main`.

> NOTE: `AGENTS.md` says this is a modified Next.js — read `node_modules/next/dist/docs/` before writing Next-specific code.
> (There is a separate, unrelated `HANDOVER.md` about a Tempo custodial-wallet migration — ignore it for this work.)

---

## Feature area: DM conversations with locked PPV cards

A creator sends a "locked" message in a DM (a `kind: "ppv"` message pointing at a `posts` row). The recipient sees a blurred preview + price + unlock button; paying via the Tempo/custodial-balance flow reveals the media.

Key files:
- `components/Conversation.tsx` — client conversation UI. `PpvCard` renders the locked/revealed card; `CallSheet` (paid calls) and `AttachSheet` (creator picks a post to send) also live here.
- `lib/messages-view.ts` — `buildConversationView(userId, threadId)` resolves each PPV message **per viewer**: if the viewer has an `unlocks` row for the post → `revealed: true` (presigns real media); else locked (blurred preview + price).
- `lib/db/messages.ts` — `getMessages()` left-joins `posts` + `unlocks` to compute `viewerUnlockId`.
- `app/messages/[id]/page.tsx` — server component; builds the view, renders `<Conversation>`.
- `app/api/messages/[id]/route.ts` — send text/ppv messages.
- `components/useUnlock.ts` + `app/api/unlock/route.ts` — pay-to-unlock flow.
- Schema: `lib/db/schema.ts` (`messages`, `posts`, `unlocks`, `threads`).

---

## Work COMPLETED this session

1. **Fixed reseed pointing PPV at an already-unlocked post** — `scripts/reseed-posts.ts`.
   - Root cause: the DM's PPV card pointed at Luna's first paid post, but the dev user auto-unlocks the first 3 paid posts (which included it) → card rendered `revealed` instead of locked.
   - Fix: added `const unlockedIds = new Set(paid.map(p => p.id))`, selects `ppvPost` as a Luna paid post **not** in that set, and deletes+rebuilds the dev↔creator thread each run so re-seeding is idempotent. (`seed.ts` never had this bug — its PPV points at `created[2]`, outside its unlocked `slice(0,2)`.)

2. **Locked PPV card restyle** — `components/Conversation.tsx` `PpvCard`:
   - Card width `w-[230px]` → `w-full`.
   - Blur `blur(2px)`/`scale(1.05)` → `blur(28px)`/`scale(1.18)` (smoother; larger scale hides edge-bleed).
   - Unlock button shows **just the price** (e.g. `$0.10`) instead of `MPP unlock · $0.10`. The lock-icon circle above it stays.

3. **`npm run new-post`** — new additive script `scripts/add-ppv-post.ts` (wired in `package.json`).
   - Drops ONE fresh, never-unlocked `kind: "ppv"` card into the dev↔luna_after_dark thread (random-seed image + random price from `["0.05","0.10","0.25"]`). Wipes nothing; uploads only that post's media.
   - **STANDING WORKFLOW (user request): run `npm run new-post` after EVERY change to the unlock flow** so there's always a fresh locked card to test. Saved as memory `new-unlockable-post-workflow.md`. Do NOT use `npm run reseed` for this (it wipes all posts).

---

## Task IN PROGRESS (NOT yet applied) — START HERE

User's two open asks:
1. **Composer ("Send a message…") still not anchored to the bottom.** An earlier `sticky bottom-0 z-40` on the composer did NOT fix it (page-level scroll + `min-h-dvh` makes bottom-sticky unreliable here).
2. **Make the PPV card "a bit smaller."**

### Planned fix: fixed-height internal-scroll layout for the conversation

Rationale (verified this session):
- The DM page renders **no `BottomNav`** — it's full-screen, so `h-dvh` is safe.
- `RouteTransition` is React `ViewTransition` with no constraining/overflow wrapper, so `h-dvh` on `<main>` won't be clipped.
- Make the **messages region the only scroller**; header + composer become non-shrinking. This is the bulletproof mobile-chat pattern and avoids sticky subtleties.

Exact edits in `components/Conversation.tsx` (line numbers as of writing — **re-grep to confirm**, the linter keeps touching this file):

- **`<main className="flex min-h-dvh flex-1 flex-col">`** (~L115)
  → `<main className="flex h-dvh flex-col">`

- **Header** (~L117): add `shrink-0`:
  `... pt-safe sticky top-0 z-40 shrink-0 border-b backdrop-blur-xl`

- **Conversation block** (~L158-159): wrap content in a scroller. Change
  ```
  {/* Conversation */}
  <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-2.5 px-3.5 py-[18px]">
  ```
  →
  ```
  {/* Conversation — the only scroller; header + composer stay fixed */}
  <div className="min-h-0 flex-1 overflow-y-auto">
  <div className="mx-auto flex w-full max-w-md flex-col gap-2.5 px-3.5 py-[18px]">
  ```
  (removed `flex-1` from the inner content div. `min-h-0` on the scroller is REQUIRED so the flex item can shrink and actually scroll.)

- **Close the new wrapper + un-stick the composer** (~L187-191): change
  ```
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <div className="bg-surface border-hairline sticky bottom-0 z-40 border-t">
  ```
  →
  ```
        <div ref={endRef} />
      </div>
      </div>

      {/* Composer */}
      <div className="bg-surface border-hairline shrink-0 border-t">
  ```

- **PPV card smaller** (~L331): `<div className="bg-surface-2 border-hairline w-full overflow-hidden rounded-[20px] border">`
  → add `max-w-[300px]`: `... w-full max-w-[300px] overflow-hidden ...`
  (300px @ 4:5 ≈ 375px tall — clearly smaller than full-bleed, still prominent. Tune if the user wants more/less.)

After editing: run `npm run new-post`, confirm `✓ Compiled` in the preview logs, and report. See verification caveat below.

---

## Key gotchas / environment

- **Cannot visually verify in the preview browser.** The `/messages/[id]` route is Clerk-auth-gated; the preview/eval browser session is NOT signed in, so it redirects to `/` (logs show `Clerk has been loaded…`). Verify compile via preview logs; rely on the user's signed-in browser for visual confirmation. Don't claim visual verification you didn't do.
- **Unlocks are permanent** per `(fanId, postId)`. Once unlocked, a card renders `revealed` forever — that's why the original test card shows the green media with no blur. Use `npm run new-post` for a fresh locked card.
- **Test thread:** `6d28df57-d219-4833-9eff-c44472475e4f` → `/messages/6d28df57-d219-4833-9eff-c44472475e4f`.
- **The floating "N" avatar** at bottom-left in screenshots is the global `PasskeyEnrollmentPrompt` (fixed-position, rendered in `components/Providers.tsx`), NOT the composer.
- Test cards **accumulate** in the thread (each `new-post` appends one). User was offered a "clear prior Fresh tease cards first" option but hasn't requested it.
- `new-post` posts are `isPublished: true`, so they also appear at the top of the main feed. User hasn't asked to hide them.
- **Dev server** is already running (preview `serverId: 8b580d14-c74e-426c-90dc-cd19982b68a4`, port 3000). Inspect with `mcp__Claude_Preview__preview_logs`.
- Commands (all need `DATABASE_URL` + `BLOB_READ_WRITE_TOKEN` in `.env.local`): `npm run new-post` (additive test card), `npm run reseed` (DESTRUCTIVE — wipes all posts + re-uploads media), `npm run seed`.
- Theme tokens (dark default): `--bg #121012`, `--surface #1a171a`, `--surface-2 #211d21`, `--primary #c2143b`, `--text #f5f2f3`. PPV card aspect ratio is `4 / 5`.

## Uncommitted state
Nothing has been committed; the user hasn't asked to. This session touched: `scripts/reseed-posts.ts`, `scripts/add-ppv-post.ts` (new), `package.json`, `components/Conversation.tsx`. The worktree also has many unrelated pre-existing edits — don't assume every dirty file is part of this work.
