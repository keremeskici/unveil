"use client";

import { useCallback, useEffect, useState } from "react";
import { useAppAuth, useAppUser } from "./useAppAuth";

// Older builds persisted a 7-day "Later" snooze here. We now nudge on every
// login until the user enrolls, so this key is only referenced to clear stale
// values left behind on returning browsers.
const LEGACY_REMIND_AFTER_KEY = "veil:passkey-remind-after";

// Fired after a passkey is created so every mounted instance (prompt, settings,
// notifications) re-reads state and re-renders.
export const PASSKEY_CREATED_EVENT = "veil:passkey-created";
// Fired when the session dismissal changes so sibling hook instances in the
// same tab stay in sync.
const DISMISS_CHANGED_EVENT = "veil:passkey-dismiss-changed";

// Session-only dismissal: clicking "Later" hides the prompt for the current
// page session but does NOT persist. A full reload or a fresh login resets it,
// so the user is nudged again until they enroll. Module-level so every hook
// instance shares the same value.
let sessionDismissed = false;

function setSessionDismissed(value: boolean) {
  sessionDismissed = value;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(DISMISS_CHANGED_EVENT));
  }
}

// Minimal view of the Clerk `UserResource` surface we touch. The dev-auth user
// object has none of these methods, which is how we tell the two apart.
type EnrollableUser = {
  passkeys?: { id: string }[];
  createPasskey: () => Promise<unknown>;
  reload: () => Promise<unknown>;
};

function isEnrollableUser(user: unknown): user is EnrollableUser {
  return (
    typeof user === "object" &&
    user !== null &&
    typeof (user as { createPasskey?: unknown }).createPasskey === "function"
  );
}

// Maps a thrown enrollment error to either a silent success (passkey already
// existed) or a user-facing message. Reads Clerk's machine-stable `.code` and
// falls back to the native WebAuthn `DOMException` name.
function classifyEnrollError(err: unknown): { alreadyExists: boolean; message: string } {
  const code = (err as { code?: string } | null)?.code;
  const name = (err as { name?: string } | null)?.name;

  if (code === "passkey_already_exists") {
    return { alreadyExists: true, message: "" };
  }
  if (
    code === "passkey_registration_cancelled" ||
    code === "passkey_retrieval_cancelled" ||
    code === "passkey_operation_aborted" ||
    name === "NotAllowedError" ||
    name === "AbortError"
  ) {
    return { alreadyExists: false, message: "Passkey setup was canceled." };
  }
  if (
    code === "passkey_not_supported" ||
    code === "passkey_pa_not_supported" ||
    code === "passkey_invalid_rpID_or_domain" ||
    name === "NotSupportedError" ||
    name === "SecurityError"
  ) {
    return {
      alreadyExists: false,
      message: "Passkeys are not supported on this browser or device.",
    };
  }
  return { alreadyExists: false, message: "Could not add passkey. Please try again." };
}

export type PasskeyEnrollment = {
  isLoaded: boolean;
  isSignedIn: boolean;
  hasPasskey: boolean;
  canEnroll: boolean;
  isPending: boolean;
  error: string | null;
  success: boolean;
  enrollPasskey: () => Promise<void>;
  dismissPrompt: () => void;
  isDismissed: boolean;
};

export function usePasskeyEnrollment(): PasskeyEnrollment {
  const { isLoaded: authLoaded, isSignedIn, isDevSignedIn } = useAppAuth();
  const { isLoaded: userLoaded, user } = useAppUser();

  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Mirror the shared session-dismissal flag and keep sibling instances in sync.
  useEffect(() => {
    // One-time cleanup of the retired 7-day localStorage snooze, so browsers
    // that snoozed under the old behavior are nudged again.
    try {
      window.localStorage.removeItem(LEGACY_REMIND_AFTER_KEY);
    } catch {
      // storage disabled — nothing to clean up.
    }
    const sync = () => setDismissed(sessionDismissed);
    sync();
    window.addEventListener(DISMISS_CHANGED_EVENT, sync);
    window.addEventListener(PASSKEY_CREATED_EVENT, sync);
    return () => {
      window.removeEventListener(DISMISS_CHANGED_EVENT, sync);
      window.removeEventListener(PASSKEY_CREATED_EVENT, sync);
    };
  }, []);

  // Dev-auth users are local/test accounts with no Clerk identity, so Clerk
  // passkey enrollment never applies to them.
  const enrollableUser =
    !isDevSignedIn && isEnrollableUser(user) ? user : null;
  const hasPasskey = Boolean(enrollableUser?.passkeys?.length);
  const isLoaded = Boolean(authLoaded) && Boolean(userLoaded);
  const canEnroll =
    isLoaded && isSignedIn === true && Boolean(enrollableUser) && !hasPasskey;

  const dismissPrompt = useCallback(() => {
    setSessionDismissed(true);
    setDismissed(true);
  }, []);

  const enrollPasskey = useCallback(async () => {
    // No-op when there is no real Clerk user to enroll (signed out or dev-auth).
    if (!enrollableUser) return;
    setIsPending(true);
    setError(null);
    try {
      await enrollableUser.createPasskey();
      await enrollableUser.reload();
      setSuccess(true);
      setSessionDismissed(false);
      window.dispatchEvent(new Event(PASSKEY_CREATED_EVENT));
    } catch (err) {
      const { alreadyExists, message } = classifyEnrollError(err);
      if (alreadyExists) {
        // A passkey already exists for this account — converge to the enrolled
        // state instead of surfacing an error.
        await enrollableUser.reload().catch(() => {});
        setSuccess(true);
        setSessionDismissed(false);
        window.dispatchEvent(new Event(PASSKEY_CREATED_EVENT));
      } else {
        setError(message);
      }
    } finally {
      setIsPending(false);
    }
  }, [enrollableUser]);

  return {
    isLoaded,
    isSignedIn: isSignedIn === true,
    hasPasskey,
    canEnroll,
    isPending,
    error,
    success,
    enrollPasskey,
    dismissPrompt,
    isDismissed: dismissed,
  };
}
