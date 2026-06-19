"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth, useClerk, useUser } from "@clerk/nextjs";
import {
  DEV_AUTH_COOKIE,
  DEV_USER_PROFILE,
  isDevAuthEnabled,
  isValidDevAuthCookie,
} from "@/lib/dev-session";

const DEV_AUTH_EVENT = "veil:dev-auth-changed";

const DEV_CLIENT_USER = {
  fullName: DEV_USER_PROFILE.displayName,
  primaryEmailAddress: { emailAddress: DEV_USER_PROFILE.email },
} as const;

function hasDevAuthCookie() {
  if (!isDevAuthEnabled() || typeof document === "undefined") return false;

  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .some((part) => {
      const [name, ...valueParts] = part.split("=");
      return (
        name === DEV_AUTH_COOKIE &&
        isValidDevAuthCookie(decodeURIComponent(valueParts.join("=")))
      );
    });
}

function useDevAuthCookie() {
  const [isDevSignedIn, setIsDevSignedIn] = useState<boolean | null>(
    isDevAuthEnabled() ? null : false,
  );

  useEffect(() => {
    const sync = () => setIsDevSignedIn(hasDevAuthCookie());
    sync();
    window.addEventListener(DEV_AUTH_EVENT, sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener(DEV_AUTH_EVENT, sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  return isDevSignedIn;
}

export function notifyDevAuthChanged() {
  window.dispatchEvent(new Event(DEV_AUTH_EVENT));
}

export function useAppAuth() {
  const auth = useAuth();
  const isDevSignedIn = useDevAuthCookie();

  if (isDevSignedIn === true) {
    return {
      ...auth,
      isLoaded: true,
      isSignedIn: true,
      isDevSignedIn: true,
    };
  }

  return {
    ...auth,
    isLoaded:
      isDevSignedIn === null && auth.isSignedIn !== true ? false : auth.isLoaded,
    isSignedIn:
      isDevSignedIn === null && auth.isSignedIn !== true
        ? undefined
        : auth.isSignedIn,
    isDevSignedIn: false,
  };
}

export function useAppUser() {
  const clerkUser = useUser();
  const isDevSignedIn = useDevAuthCookie();

  if (isDevSignedIn === true) {
    return {
      ...clerkUser,
      isLoaded: true,
      isSignedIn: true,
      user: DEV_CLIENT_USER,
      isDevSignedIn: true,
    };
  }

  return {
    ...clerkUser,
    isLoaded:
      isDevSignedIn === null && clerkUser.isSignedIn !== true
        ? false
        : clerkUser.isLoaded,
    isSignedIn:
      isDevSignedIn === null && clerkUser.isSignedIn !== true
        ? undefined
        : clerkUser.isSignedIn,
    isDevSignedIn: false,
  };
}

export function useAppSignOut() {
  const { signOut } = useClerk();
  const isDevSignedIn = useDevAuthCookie() === true;

  return useCallback(
    async ({ redirectUrl = "/" }: { redirectUrl?: string } = {}) => {
      if (!isDevSignedIn) {
        await signOut({ redirectUrl });
        return;
      }

      await fetch("/api/dev/logout", { method: "POST" });
      notifyDevAuthChanged();
      window.location.assign(redirectUrl);
    },
    [isDevSignedIn, signOut],
  );
}
