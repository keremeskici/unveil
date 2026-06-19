# Fixes Checklist

## Research Notes And Pitfalls

- Use `100dvh`/safe-area-aware sizing for phone-like screens so fixed headers/nav do not create accidental landing-page scroll.
- Keep bottom navigation visually separate from app content with a strong surface, border/elevation, active states, and enough bottom safe-area padding.
- Avoid nested scroll regions inside feed cards. A single post card should be sized and composed so the main card fits in one viewport whenever possible.
- Modal sheets for comments/tips should have clear scrims, focused surfaces, escape/close affordances, body scroll lock, and reduced-motion behavior.
- Smooth transitions should respect `prefers-reduced-motion`.
- Next 16 route slide transitions should use `experimental.viewTransition`, `ViewTransition`, and `transitionTypes` on tab/chat links so animation direction is explicit.
- Any payment/unlock state must be backed by server data, not only local client state, so buttons disappear consistently after refresh/navigation.
- Tempo platform signing must validate `PLATFORM_PRIVATE_KEY` at the app boundary. Common `.env` pitfalls are quotes, whitespace, missing `0x`, or accidentally storing a label instead of a 32-byte hex key.
- Metered call billing needs server-side idempotency by call session and settlement tick; browser retries must not double-charge.
- MPP/402 failures should use HTTP 402 with a payment challenge shape, while successful call ticks should return receipt-like metadata and refresh client balance.
- The call screen should feel consumer-native: ringing before connected, no visible protocol jargon, and settlement after the call ends rather than while the timer is running.
- Username onboarding should update the app database through `/api/user` and handle uniqueness/validation errors.
- Next.js 16/React 19 notes for this repo: keep interactive pieces in client components, await async route params, avoid relying on proxy for authorization, and keep runtime DB work in server/route code.
- Agent UI audit: comments/tips/settings/edit/attach sheets each lock body scroll; avoid overlapping restore bugs while adding transitions.
- Agent UI audit: one-card-per-screen requires feed viewport math around sticky top chrome and fixed bottom nav, not only changing card height.
- Agent data audit: PPV locked post cards inside DMs already exist; paid text messages and pay-per-second calling do not.
- Agent data audit: whole-post unlocks are server-idempotent, but the feed does not seed already-unlocked full posts, so the UI can still show an unlock overlay after refresh.

## Clarifications Needed

- Logo/name: What exact new brand name and logo direction should replace `VEIL` and the current conic dot?
- Landing screen: Should the non-scrollable landing screen be the signed-out onboarding screen only, or also the signed-in feed first viewport?
- Payment cards naming: Should every user-facing `Payment cards` / `Your cards` label become `Billing`, or should the route also change from `/payment-cards` to `/billing`?
- Balance click: Which balance display should be clickable: the top connect/balance pill, the tip-sheet wallet balance, profile balance, or all balances?
- Notification button rework: Do you want a new top-bar notification button, a changed bottom-nav notifications tab, or different notification row actions?
- Follow and chat buttons: Where should they appear: on every feed card creator header, search creator rows, profile pages, or all of those?
- Pay per message and pay per second calling: Is this a visual prototype only for the hackathon, or should it include database schema/API/payment ledger behavior?
- Pay per message: Should fans pay to send any text to a creator, or should creators send paid/locked message cards that fans unlock?
- Pay per second calling: Should there be actual call UI/timers and billing simulation, or only creator rate settings and call buttons?

## Work Plan

- [ ] Confirm unclear product decisions above.
- [x] Make landing/onboarding fit one viewport without body scroll.
- [x] Replace logo/name with Unveil and a red-curtain-into-black mark.
- [x] Make balance displays navigate to billing/payment cards.
- [x] Rename cards surfaces to billing, preserving `/payment-cards`.
- [x] Strengthen visual separation between nav bars and content.
- [x] Make comments visually clearer and improve sheet transitions.
- [x] Make tip and comments open/close transitions smoother.
- [x] Generate username during first onboarding via an idempotent server helper and persist it in the database.
- [x] Defer notification button/navigation behavior.
- [x] Add/improve follow and chat buttons across feed/search; profile remains the signed-in user's own page.
- [x] Make one feed card fit one viewport without internal card scrolling.
- [x] Add a batched full-post ownership query and hide whole-post unlock buttons when the current user already unlocked the video/post.
- [x] Add smooth transitions between tab/filter changes where touched.
- [x] Add slide-over route transitions for bottom tabs and chat/thread navigation.
- [x] Normalize and validate `PLATFORM_PRIVATE_KEY` before viem receives it, with clearer top-up funding errors.
- [x] Preserve existing creator-sent paid locked DM cards and label them as MPP unlocks; add MPP per-second call UI.
- [x] Remove parenthetical Billing/Payment drawer hints.
- [x] Replace the dedicated Tips notification chip with New posts from followed creators.
- [x] Add real post-call metered MPP/402 settlement from fan balance to creator balance, with idempotent ledger entries and 402 on insufficient funds.
- [x] Add ringing-before-connected call state and remove visible technical MPP/402 copy from the call sheet.
- [x] Run type/build checks.
- [x] Browser verify signed-out landing; signed-in dev-login did not fire in the browser automation surface, so feed verification is covered by build/typecheck.
- [x] Swap the app icon to the latest red eye image and match the top feed header to its black background.
- [x] Regenerate installable PWA icons from the same red eye asset.
- [x] Remove vertical scroll snap while preserving the one-post-per-viewport feed card sizing.
- [x] Make the comment composer slide up when the text box receives focus.
- [x] Replace notification All/Mentions filters with a real Bookmarks tab backed by saved posts.
- [x] Rename feed snap class to feed scroll and remove remaining snap behavior.
- [x] Compact login option buttons and remove the favorite-creators headline.
- [x] Swap to the latest red eye logo and show only one brand mark on the login screen.
- [x] Revert custom brand font back to the original app font and show only the word UNVEIL on the login screen.
- [x] Show logo plus title on onboarding, and show only the word UNVEIL in the signed-in top bar.
- [x] Skip the reveal animation for media that was already unlocked before the page loaded.
- [x] Replace the tip success micro-confirmation with a red full-screen upward-arrow completion animation.

## Agent Findings

- UI files likely affected: `app/page.tsx`, `components/Onboarding.tsx`, `components/TopBar.tsx`, `components/BottomNav.tsx`, `components/PostCard.tsx`, `components/CommentsSheet.tsx`, `components/TipSheet.tsx`, `components/Wordmark.tsx`, `app/globals.css`, `app/notifications/page.tsx`, `app/messages/page.tsx`, `app/messages/[id]/page.tsx`, `app/search/page.tsx`, `app/payment-cards/page.tsx`, `components/SettingsDrawer.tsx`.
- Data/payment files likely affected: `lib/db/queries.ts`, `app/page.tsx`, `components/PostCard.tsx`, `components/UnlockButton.tsx`, `components/ConnectButton.tsx`, `app/api/messages/[id]/route.ts`, `app/messages/[id]/page.tsx`, and new schema/API files only if paid text or per-second calling are in scope.
- Recommended implementation order: stabilize app chrome and feed sizing first, update post actions and sheet transitions second, handle username/unlock state third, then billing copy/routes, then paid messaging/calling.
