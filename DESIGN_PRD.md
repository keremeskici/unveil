# Design PRD — Veil UI System

> Mobile-first PWA · pay-per-tap blur-to-reveal · built on Tempo.
> This is the **design source of truth** for the `ui/design-system` branch. The product/feature PRD lives at `.claude/.md/PRD.md`; this doc owns look, feel, tokens, components, and screens.

---

## 0. Status

- **Owner:** Kerem
- **Last updated:** 2026-06-18
- **Branch:** `ui/design-system`
- **Approach:** **Design-system-first** — lock tokens + component library, then compose screens.
- **Locked decisions (this session):**
  - Brand color: **deep crimson / wine `#C2143B`** on warm charcoal `#121012` — premium, velvet, restrained (NOT neon).
  - Mode: **dark by default, light mode behind a toggle** (toggle lives in the settings drawer).
  - Name: **unnamed for now** — neutral placeholder wordmark.
- **Replaces:** the current placeholder UI uses **purple** (`bg-purple-600`, `text-purple-400`) and **emoji nav** — both are deprecated by this PRD.

---

## 1. Design goals & principles

1. **OnlyFans-simple, old-Twitter-familiar.** A vertical feed of cards, a 5-slot bottom nav, a top bar with a wordmark + search. Zero learning curve. Nothing clever where convention works.
2. **Premium, not loud.** Wine-on-charcoal reads "private club," not "casino." Restraint is the brand. Crimson is a *scalpel* — used on the unlock CTA, the active nav item, the proof chip, and tier accents. Everywhere else is grayscale.
3. **The tap is the product.** The blur→pay→reveal moment must feel physical and instant: haptic, shimmer, settle. Every other screen exists to get the user to that tap.
4. **Show the magic.** Judges must *see* Tempo doing something normal apps can't. The "proof of magic" chip (`amount · settle ms · $0 gas`) is a first-class, recurring UI element, not a tooltip.
5. **Demo-legible at arm's length.** Everything must read in a 3-minute screen-recorded demo on a phone. Big targets, high contrast, obvious state changes.
6. **Mobile-first, install-worthy.** Designed for a 390–430px viewport, safe-area aware, looks native enough that "Add to Home Screen" feels right.

---

## 2. Brand direction

| Attribute | Direction |
|---|---|
| Personality | Sultry, premium, confident. "Velvet rope," not "strip mall." |
| Color story | Charcoal canvas → wine crimson for desire/action → off-white for content → a single restrained gold for status/tiers. |
| Texture | Soft, generous radii (cards 24px, buttons full-pill). Subtle elevation via tint + low-spread shadows, never harsh borders. |
| Light | A faint crimson *glow* under the primary CTA and on the reveal shimmer — the only "neon" we allow, and only on the hero action. |
| Voice | Short, knowing, a little flirty. "Lift the veil." "Tap to reveal." "Settled." Never crude. |

---

## 3. Design tokens

Stack is **Tailwind v4** (no `tailwind.config.ts`) — tokens go in `app/globals.css` via `@theme` + CSS variables, with `.dark` / `:root` for mode. Below is the canonical token set; treat hex values as authoritative.

### 3.1 Color — dark (default)

```css
:root {
  /* Canvas & surfaces */
  --bg:            #121012;  /* app canvas (warm charcoal) */
  --surface:       #1A171A;  /* sheets, top bar, nav */
  --surface-2:     #211D21;  /* cards */
  --surface-3:     #2A252A;  /* hover / pressed surface */
  --hairline:      rgba(255,255,255,0.08);
  --hairline-strong: rgba(255,255,255,0.14);

  /* Brand (wine crimson) */
  --primary:       #C2143B;  /* default action */
  --primary-hover: #D81B47;
  --primary-press: #A30F31;
  --primary-fg:    #FFFFFF;
  --primary-glow:  rgba(194,20,59,0.45); /* CTA halo / reveal shimmer */
  --primary-tint:  rgba(194,20,59,0.12); /* chip bg, selected states */

  /* Text */
  --text:          #F5F2F3;  /* warm off-white, primary */
  --text-muted:    #A8A0A4;  /* secondary */
  --text-faint:    #6E666B;  /* tertiary / metadata */

  /* Status (used sparingly) */
  --success:       #34D399;  /* "settled" / 0 gas confirm dot */
  --gold:          #E8B339;  /* tier badges, flex card accent ONLY */
  --danger:        #F0506E;  /* errors, declines */
}
```

### 3.2 Color — light (toggle)

```css
.light {
  --bg:            #FFFFFF;
  --surface:       #FFFFFF;
  --surface-2:     #FAFAF9;
  --surface-3:     #F2F0F1;
  --hairline:      rgba(0,0,0,0.08);
  --hairline-strong: rgba(0,0,0,0.14);

  --primary:       #B01237;  /* slightly deeper for AA on white */
  --primary-hover: #C2143B;
  --primary-press: #930F2E;
  --primary-fg:    #FFFFFF;
  --primary-glow:  rgba(176,18,55,0.28);
  --primary-tint:  rgba(176,18,55,0.10);

  --text:          #1A1718;
  --text-muted:    #5C5559;
  --text-faint:    #8A8287;

  --success:       #15A06B;
  --gold:          #B8860B;
  --danger:        #D23150;
}
```

> **Default = dark.** Set `class="dark"`-equivalent by making `:root` the dark theme and `.light` the override (above). Persist choice in `localStorage`, default to dark, no flash-of-wrong-theme on load.

### 3.3 Typography

- **UI / body:** Geist Sans (already loaded). Weights 400/500/600/700.
- **Numerals (prices, settle ms, token balances, PnL):** **Geist Mono**, tabular. Every "$0.02", "480ms", "$0 gas", and token figure uses mono so they line up and feel "machine-true."
- **Display (wordmark + flex card hero):** a tight grotesque/display face — recommend **General Sans** or **Clash Display** (Fontshare, free). Fallback to Geist Sans 700 + tight tracking if not added.

| Token | Size / line | Use |
|---|---|---|
| `display-xl` | 34 / 38, -2% | Flex card hero number, onboarding headline |
| `title` | 22 / 28, 600 | Screen titles, wordmark |
| `body-lg` | 17 / 24, 500 | Post captions, primary content |
| `body` | 15 / 22, 400 | Default text |
| `label` | 13 / 18, 600 | Buttons, nav labels, usernames |
| `meta` | 12 / 16, 500 | Timestamps, handles, proof chip |
| `mono-num` | 14 / 18, 500 (mono) | Prices, settle ms, balances |

### 3.4 Space, radius, elevation, motion

```css
@theme {
  /* radius */
  --radius-card: 24px;   /* post cards, sheets */
  --radius-md:   16px;   /* inner media, inputs */
  --radius-pill: 9999px; /* buttons, chips, avatars */

  /* spacing base = 4px; key rhythm: 4 8 12 16 20 24 32 */

  /* elevation (tint + soft shadow, no harsh lines) */
  --shadow-card: 0 1px 0 rgba(255,255,255,0.03) inset, 0 8px 24px rgba(0,0,0,0.35);
  --shadow-cta:  0 8px 28px var(--primary-glow);

  /* motion */
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --dur-fast: 140ms;
  --dur-base: 240ms;
  --dur-reveal: 620ms;
}
```

- **Tap targets:** min 44×44px. Bottom nav icons, kebabs, unlock buttons all comply.
- **Blur gate:** preview blur `blur(12px) scale(1.08)` over a `bg-black/40` scrim (server still owns gating — CSS blur is cosmetic only).

---

## 4. Component library (build these first)

Order = dependency order. Each is a real component in `components/`.

### Tier 0 — primitives
1. **Tokens** (`globals.css` `@theme` + vars, dark/light, theme toggle util).
2. **Icon set** — replace ALL emoji. Use `lucide-react` (home, bell, plus-square, message-circle, user, lock, search, more-horizontal, check-badge, share, sparkles). Stroke 1.75, sized 24.
3. **Button** — variants: `primary` (wine pill, `--shadow-cta` on hover), `secondary` (surface-2 pill), `ghost`, `icon`. States: default/hover/press/disabled/loading.
4. **Avatar** — circle, sizes 28/36/44, optional `verified` crimson check-badge overlay, online dot.
5. **Pill / Chip** — base for ProofChip, TierBadge, token-balance.

### Tier 1 — signature
6. **UnlockButton** — the hero. Pill, wine fill, crimson glow. Content morphs: `Unlock · $0.02` → spinner → ✓ flash. Fires haptic (`navigator.vibrate(8)`) on tap. Drives the reveal.
7. **BlurGate** — locked overlay on media: blurred preview + scrim + lock glyph + price line + UnlockButton. The thing users tap. (Real asset arrives only post-payment via signed URL.)
8. **ProofChip** — "proof of magic." Glass chip, `--primary-tint` bg, mono text: `$0.02 · 480ms · $0 gas`, with a pulsing `--success` dot meaning "settled." Springs up on reveal. Recurs anywhere a payment happens.
9. **RevealMedia** — the animation wrapper: `blur(20px)→0`, `opacity 0→1`, `scale 1.06→1`, `--dur-reveal --ease-out`, plus a one-shot crimson shimmer sweep. Respects `prefers-reduced-motion` (cross-fade only).

### Tier 2 — composition
10. **PostCard** — creator header (avatar + name + verified + handle + timestamp + kebab) → caption → media (BlurGate or RevealMedia) → footer (ProofChip after unlock, like/comment/tip/share row).
11. **TopBar** — wordmark left, search + menu right; translucent `--surface` with backdrop blur; safe-area top.
12. **BottomNav** — 5 slots matching OF: Feed · Notifications · New (center, crimson accent) · Messages (badge) · Profile (avatar). Active = crimson icon + label. Safe-area bottom.
13. **Sheet / Drawer** — right-side profile menu (mirrors the OF screenshot: avatar, fans/following, My profile, Collections, Settings, cards, Become a creator, Help, **Dark mode toggle**, language, Log out).
14. **Composer** — "Compose new post…" inline field + new-post screen (creator).
15. **TierBadge / TokenBalance** — gold-accented status pill from loyalty-token balance.
16. **FlexCard** — PnL-style share card (see §5.3). Two forms: in-app React component AND the `@vercel/og` server render spec (same layout).
17. **ConnectButton / Onboarding** — "Sign in with Face ID" (Tempo passkey), funding state, access-key authorize.
18. **InstallBanner** — PWA add-to-home prompt (exists; reskin to tokens).
19. **Feedback** — Toast, inline error, Skeleton/shimmer loaders, EmptyState (reskin existing).

---

## 5. Signature moments (where we win)

### 5.1 The reveal
Tap → haptic → button morphs to spinner → server verifies receipt → signed URL returns → `RevealMedia` plays: blur lifts, image scales to rest, a crimson shimmer sweeps once left-to-right, ProofChip springs up underneath. Target perceived time: feels instant (<600ms anim, masking the ~500ms settle). This single sequence is the demo's money shot — storyboard the video around it.

### 5.2 Proof of magic
Every unlock leaves a ProofChip. On the profile, a running "lifetime" strip: total unlocked, total paid, avg settle ms, total gas `$0`. Make the `$0 gas` and sub-second settle the emotional payoff — they're the things a card-based app physically cannot show.

### 5.3 Flex card (the viral wow)
Robinhood/Binance-PnL-style shareable image: charcoal→wine gradient, big mono balance, tier badge (gold), rank/streak/"degen score," wordmark, QR or @handle. Rendered server-side via `@vercel/og` for share-to-X/Telegram; mirrored in-app for preview. This is the standout-from-OnlyFans creative beat — give it the most visual richness in the whole app (the one place gold + gradient + glow all show up together).

---

## 6. Screens (composed from §4)

| Screen | Built from | Notes |
|---|---|---|
| **Onboarding / Connect** | Onboarding, ConnectButton, Button | "Sign in with Face ID," one-line value prop, install hint. Dark hero with crimson glow. |
| **Feed (home)** | TopBar, PostCard×N, BottomNav, Composer (collapsed) | The default screen. Vertical scroll of cards. This is what judges see first. |
| **Unlock flow** | BlurGate → UnlockButton → RevealMedia → ProofChip | Inline in the feed card; no page nav needed. |
| **Profile (own + creator)** | TopBar, Avatar, TierBadge, ProofChip strip, PostCard grid/list | Wallet-keyed. Shows tier, token balance, lifetime proof stats, creator's locked posts. |
| **Flex card** | FlexCard, Button(share) | Generate + share. Its own celebratory screen. |
| **Settings drawer** | Sheet, theme toggle, list rows | Houses the **dark/light toggle**, language, log out, become-a-creator. |
| **Messages** *(stretch)* | List rows, Avatar, badges | Matches OF messages screenshot. |
| **Notifications** *(stretch)* | Tabs, list/empty state | "All / Tags / Comments / Mentions." |
| **Creator / New post** *(stretch)* | Composer, upload, price field | Set per-unlock price; replaces seeded demo content. |

---

## 7. Motion & interaction rules

- **One hero animation:** the reveal. Everything else is quiet (140–240ms ease-out fades/slides).
- **Haptics:** tap-to-unlock and successful settle (`navigator.vibrate`). Subtle.
- **Press feedback:** buttons scale to `0.97`, surfaces darken to `--surface-3`.
- **Nav:** active item color-shifts to crimson with a small spring; no page transitions heavier than a cross-fade.
- **Reduced motion:** replace blur/scale/shimmer with a plain opacity cross-fade; never block reveal on motion prefs.

---

## 8. Accessibility & PWA constraints

- Contrast AA: `--text` on `--bg`, `--primary-fg` on `--primary` both pass. Verify crimson-on-white in light mode (that's why light primary is deeper `#B01237`).
- Hit targets ≥44px; focus-visible rings in crimson at 2px.
- Safe-area insets on TopBar (top) and BottomNav (bottom) — `pt-safe` / `pb-safe` helpers already exist.
- No reliance on color alone (proof chip pairs the success dot with the word "settled").
- PWA: installable, themed splash/status bar to `--bg`, offline shell. Manifest `theme_color` = `#121012`.

---

## 9. Implementation notes

- **Tailwind v4:** all tokens via `@theme` + CSS vars in `app/globals.css`. No config file.
- **Purge purple:** replace `bg-purple-600` / `text-purple-400` (in `app/page.tsx`, `components/PostCard.tsx`, EmptyState avatar) with crimson tokens.
- **De-emoji:** swap the `🏠 ⭐ 👤` / `🔒` placeholders for `lucide-react` icons.
- **Theme toggle:** add a `ThemeProvider` (or minimal `localStorage` + `documentElement.classList`) defaulting to dark; expose toggle in the settings Sheet.
- **Reuse what's built:** PostCard reveal logic, ProofChip, UnlockButton, InstallBanner, TopBar already exist — this is a **reskin + componentize**, not a rewrite. Keep the server-side gating contract untouched.
- **Fonts:** keep Geist Sans/Mono; optionally add one display face via `next/font` for wordmark + flex card.

---

## 10. The generation prompt (paste-ready)

> Use this to generate the full UI in one shot (e.g. with the `frontend-design` skill or a fresh Claude build pass). It encodes every decision above.

```
Build the full mobile-first UI for a pay-per-tap "blur-to-reveal" creator-content
PWA (codename Veil) on Next.js 16 App Router + React 19 + Tailwind v4 + framer-motion.
Reskin/extend the existing components; keep server-side gating intact.

BRAND: premium, sultry, "velvet rope" — NOT neon, NOT a casino. OnlyFans-simple,
old-Twitter-familiar: vertical card feed, 5-slot bottom nav, top bar with wordmark.
Use a neutral placeholder wordmark (no name yet).

THEME: dark by default, light mode behind a toggle in the settings drawer. Tokens in
globals.css via Tailwind v4 @theme + CSS vars, persisted to localStorage, no FOUC.
  Dark:  bg #121012, surface #1A171A, card #211D21, hairline rgba(255,255,255,.08),
         text #F5F2F3 / muted #A8A0A4 / faint #6E666B.
  Brand: wine crimson #C2143B (hover #D81B47, press #A30F31), glow rgba(194,20,59,.45),
         tint rgba(194,20,59,.12). Light mode primary deepens to #B01237.
  Accents (sparingly): success #34D399 ("settled" dot), gold #E8B339 (tiers + flex card).
  Radius: cards 24px, buttons/chips full-pill. Soft tint elevation, no harsh borders.
  Type: Geist Sans for UI; Geist Mono (tabular) for ALL numerals — prices, settle-ms,
        balances, PnL. Optional display face for wordmark + flex card.

REPLACE all placeholder purple (bg-purple-600 / text-purple-400) with crimson tokens,
and all emoji (🏠⭐👤🔒) with lucide-react icons.

BUILD design-system-first, in this order:
  Primitives: Button (primary/secondary/ghost/icon + loading), Avatar (+verified check),
              Chip/Pill, icon set.
  Signature:  UnlockButton (wine pill, glow, morphs Unlock·$price → spinner → ✓, haptic),
              BlurGate (blurred preview + scrim + lock + price + CTA),
              ProofChip (glass, mono "$0.02 · 480ms · $0 gas" + pulsing success dot),
              RevealMedia (blur 20→0, opacity 0→1, scale 1.06→1, 620ms ease-out, one crimson
              shimmer sweep; prefers-reduced-motion → cross-fade only).
  Composition: PostCard, TopBar, BottomNav (Feed·Notifications·New·Messages·Profile,
              active=crimson), Sheet/Drawer (profile menu + dark/light toggle), Composer,
              TierBadge/TokenBalance, FlexCard (PnL share card: charcoal→wine gradient, big
              mono balance, gold tier, rank/streak/degen score, wordmark — also as @vercel/og
              spec), ConnectButton/Onboarding ("Sign in with Face ID"), InstallBanner, Toast,
              Skeleton, EmptyState.

SCREENS: Onboarding/Connect, Feed (default), inline Unlock flow, Profile (tier + lifetime
proof strip + locked posts), Flex card, Settings drawer. Stretch: Messages, Notifications,
Creator/New-post.

HERO MOMENT: the reveal. Tap → haptic → button spinner → reveal animation → ProofChip springs
up. Make $0 gas and sub-second settle the emotional payoff. Everything else stays quiet
(140–240ms fades). Mobile-first 390–430px, safe-area aware, ≥44px targets, AA contrast.
```

---

## 10b. Claude Design prompt (interactive prototype)

> Paste-ready for the **Claude Design** tool ("Start with context" → *Describe what you want to create…*). Unlike §10 (a code-build pass), this targets a **hi-fi interactive prototype** grounded in the attached OnlyFans screenshots + the `mpp-onlyfans` codebase chip. Keep the codebase chip attached so generated screens map back to real components (PostCard / ProofChip / UnlockButton).

```
Design a full mobile-first interactive prototype for "Veil" — a pay-per-tap,
blur-to-reveal premium creator-content PWA (think OnlyFans' simplicity, but the
juicy part of every post is blurred and a single tap pays a few cents in stablecoin
to instantly unveil it). Match the layout conventions and simplicity of the attached
OnlyFans screenshots (vertical card feed, 5-slot bottom nav, top bar with wordmark),
but with a completely different, premium look.

BRAND & FEEL: sultry, premium, "velvet rope" — NOT neon, NOT a casino. Confident and
restrained. A little flirty in voice ("Lift the veil", "Tap to reveal", "Settled").
Use a neutral placeholder wordmark — no real name yet.

VISUAL SYSTEM (use these exact values):
- Dark mode by default. Canvas charcoal #121012, surface #1A171A, cards #211D21,
  hairlines rgba(255,255,255,0.08).
- Brand color = deep wine crimson #C2143B (hover #D81B47), used as a SCALPEL — only on
  the unlock CTA, the active nav item, the proof chip, and tier accents. Everything else
  is grayscale. A soft crimson glow (rgba(194,20,59,0.45)) sits under the primary CTA and
  in the reveal animation — the only "neon" allowed.
- Text: warm off-white #F5F2F3, muted #A8A0A4, faint #6E666B.
- Accents, sparingly: success green #34D399 (a "settled" dot), gold #E8B339 (tier badges
  + the flex card only).
- Cards 24px radius, buttons & chips full-pill. Soft tinted elevation + low shadows,
  no harsh borders.
- Type: clean grotesque (Geist/Inter) for UI; a MONOSPACE for all numerals — prices,
  settle-ms, balances, PnL — so they feel "machine-true" (e.g. "$0.02 · 480ms · $0 gas").
- Mobile frame 390–430px wide, safe-area aware, big ≥44px tap targets, high contrast.

SCREENS TO PRODUCE (interactive, navigable):
1. Onboarding / Connect — "Sign in with Face ID", one-line hook, dark hero with crimson glow.
2. Feed (home, default) — vertical scroll of post cards: creator header (avatar + name +
   crimson verified tick + @handle + timestamp + kebab), caption, then media. Premium media
   is shown BLURRED behind a dark scrim with a lock glyph and a wine "Unlock · $0.02" pill.
3. Unlock + reveal flow (the hero, inline in the card) — tap the pill → it morphs to a
   spinner → the blur lifts as the image scales to rest with a one-shot crimson shimmer
   sweep → a "proof of magic" chip springs up under it: glass pill, mono text
   "$0.02 · 480ms · $0 gas" with a pulsing green "settled" dot. This is the money shot —
   make it feel physical and instant.
4. Profile — wallet-keyed: avatar, gold tier badge, loyalty-token balance, a "lifetime proof"
   strip (total unlocked · total paid · avg settle ms · $0 gas), and a grid/list of locked posts.
5. Flex card — a Robinhood/Binance-PnL-style SHAREABLE card: charcoal→wine gradient, huge mono
   token balance, gold tier, rank/streak/"degen score", wordmark, share button. This is the
   creative wow — give it the richest visuals in the app (the one place gold + gradient + glow
   combine). Its own celebratory screen.
6. Settings drawer — right-side sheet (mirror the attached OnlyFans menu): profile, fans/
   following, Collections, Settings, Your cards, Become a creator, Help, a dark/light toggle,
   language, Log out.
Bottom nav (all 5 screens): Feed · Notifications · New (center, crimson) · Messages · Profile,
active item in crimson. Replace any emoji with clean line icons.

INTERACTION: make the prototype tappable — nav between screens, and the feed → tap locked
post → unlock → reveal → proof-chip sequence fully playable. Keep all motion quiet (quick
140–240ms fades) EXCEPT the reveal, which is the one hero animation.
```

---

## 11. Open design questions

1. **Wordmark / name** — still TBD. Placeholder for now; revisit before final polish.
2. **Display font** — add General Sans/Clash Display, or stay all-Geist? (Lower effort: all-Geist.)
3. **Flex card richness** — how far to push gold + gradient + glow vs. staying restrained?
4. **Light mode priority** — ship dark-perfect first; light mode is a fast-follow if demo time is tight.
5. **Creator surfaces** — seeded demo content only, or build the New-post/upload screen for the demo?
```
