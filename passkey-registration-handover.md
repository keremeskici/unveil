# Handover: Passkey Registration + Notification Flow

## Goal

Implement Clerk-backed passkey registration for signed-in VEIL users.

Users who are logged in but do not have a passkey should see a clear prompt to add one. The app already supports passkey sign-in; this work adds the account assignment/enrollment flow.

## Current State

- Auth is Clerk-backed.
- `@clerk/nextjs` is installed at `^7.5.5`.
- Passkey sign-in already exists in `components/Onboarding.tsx` through `signIn.authenticateWithPasskey({ flow: "discoverable" })`.
- No passkey registration UI exists yet.
- Clerk user objects expose `user.passkeys`.
- Clerk user objects support `user.createPasskey()`.
- Dev-auth users are local/test users and should not see Clerk passkey enrollment UI.

Relevant files:

- `components/useAppAuth.ts`
- `components/Providers.tsx`
- `components/SettingsDrawer.tsx`
- `components/ConnectButton.tsx`
- `app/notifications/page.tsx`
- `components/Onboarding.tsx`

Important repo warning:

- The worktree has many unrelated modified and untracked files. Do not revert or sweep unrelated changes into commits.

## Product Decisions

Use these defaults:

- Show a compact global prompt for signed-in users without a passkey.
- Also show a synthetic in-app notification row on the Notifications page.
- Allow "Later" dismissal for 7 days in the current browser.
- Implement first-passkey registration only.
- Do not implement passkey rename/delete management in this pass.
- Do not add a database migration.
- Do not add a server API unless absolutely required.

## Clerk Requirements

Clerk Dashboard must have passkeys enabled.

Implementation should use:

```ts
await user.createPasskey();
await user.reload();
```

A user is considered enrolled when:

```ts
Boolean(user?.passkeys?.length);
```

Production caveats:

- Clerk passkeys require a paid plan in production.
- Passkeys are domain-bound.
- Users can have up to 10 passkeys per Clerk account.

## Implementation Plan

### 1. Add a Shared Passkey Enrollment Hook

Create a reusable client hook, likely `components/usePasskeyEnrollment.ts`.

Responsibilities:

- Use `useAppUser()` and `useAppAuth()`.
- Return:
  - `isLoaded`
  - `isSignedIn`
  - `hasPasskey`
  - `canEnroll`
  - `isPending`
  - `error`
  - `success`
  - `enrollPasskey()`
  - `dismissPrompt()`
  - `isDismissed`
- Exclude dev-auth users.
- Detect passkey state from `user.passkeys`.
- `enrollPasskey()` should:
  - no-op if no real Clerk user
  - call `user.createPasskey()`
  - call `user.reload()`
  - clear dismissal state
  - dispatch `window.dispatchEvent(new Event("veil:passkey-created"))`
- Handle Clerk/WebAuthn errors:
  - cancellation: neutral "Passkey setup was canceled."
  - unsupported browser/device: "Passkeys are not supported on this browser or device."
  - already exists: treat as success and reload user
  - generic: "Could not add passkey. Please try again."

Use localStorage key:

```ts
veil:passkey-remind-after
```

Dismissal rule:

- "Later" sets timestamp to `Date.now() + 7 days`.
- Hide prompt while current time is below that timestamp.
- Successful enrollment removes the key.

### 2. Add Global Prompt

Add a `PasskeyEnrollmentPrompt` client component.

Mount it inside `components/Providers.tsx`, alongside `{children}`.

Render conditions:

- Clerk/app auth loaded
- signed in
- real Clerk user, not dev-auth
- no passkey
- not dismissed
- current route is not `/sign-in` or `/sso-callback`

Use `usePathname()` from `next/navigation`.

UI behavior:

- Compact bottom banner/sheet above bottom nav.
- Include lock/passkey icon.
- Text: "Add a passkey for faster, safer login."
- Primary CTA: "Add passkey"
- Secondary CTA: "Later"
- Pending state while WebAuthn prompt is open.
- Success state after registration.

Keep it visually consistent with VEIL:

- dark surface
- primary red CTA
- 8px or modest radius unless matching existing pill buttons
- no instructional wall of text

### 3. Add Account Surface Actions

In `SettingsDrawer`:

- Add a security row labeled `Passkey`.
- If user has a passkey: show `Connected`.
- If missing: show `Recommended` and an inline `Add` action.
- Use the shared hook.

In `ConnectButton` popover:

- If signed in and missing a passkey, add a compact row/button: `Secure with passkey`.
- Use the shared hook.
- Do not duplicate Clerk logic.

### 4. Add Notifications Page Synthetic Row

In `app/notifications/page.tsx`:

- Keep `/api/notifications` unchanged.
- Add a local-only synthetic notification when:
  - signed in
  - real Clerk user
  - no passkey
  - not dismissed

Suggested row:

- Icon: lock
- Title/body: "Add a passkey to make future logins faster."
- CTA: "Add"
- Secondary action: "Later"

This should prepend above existing notification items but not be returned from the API.

### 5. Keep Existing Passkey Sign-In

Do not remove or rewrite the existing sign-in passkey flow in `Onboarding`.

The existing sign-in button should continue to call:

```ts
signIn.authenticateWithPasskey({ flow: "discoverable" });
```

This project already uses Clerk legacy sign-in APIs in `Onboarding`; passkey registration should use the current signed-in `user.createPasskey()` method.

## Test Plan

Run:

```bash
npm run build
```

Manual scenarios:

1. Signed out
   - No passkey enrollment prompt appears.
   - Existing passkey sign-in button remains visible on `/sign-in`.

2. Signed in without passkey
   - Global prompt appears on feed/profile/messages/notifications.
   - Prompt does not appear on `/sign-in` or `/sso-callback`.
   - Settings drawer shows passkey as recommended.
   - Account popover shows secure-with-passkey action.
   - Notifications page shows synthetic passkey row.

3. Successful registration
   - Clicking Add opens platform/browser passkey prompt.
   - On success, `user.reload()` runs.
   - Prompt and notification disappear.
   - Settings drawer shows connected.
   - Dismissal localStorage key is cleared.

4. Cancellation
   - Canceling WebAuthn prompt does not crash.
   - UI shows neutral cancellation message.
   - User can retry.

5. Unsupported browser/device
   - Show clear unsupported message.
   - App remains usable.

6. Dismissal
   - Clicking Later hides global prompt and synthetic notification for 7 days.
   - Existing account/settings action can still manually start enrollment.
   - Successful enrollment clears dismissal state.

7. Existing passkey user
   - No global prompt.
   - No synthetic notification.
   - Settings says connected.

8. Dev-auth user
   - No Clerk passkey enrollment UI.

## Non-Goals

- No passkey rename UI.
- No passkey delete UI.
- No database schema changes.
- No push/browser notification permission flow.
- No changes to payment, wallet, or custodial ledger code.
