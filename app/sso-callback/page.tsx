"use client";

import { useEffect, useState } from "react";
import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";
import { useRouter } from "next/navigation";

const OAUTH_ERROR_PARAMS = [
  "error",
  "error_description",
  "error_code",
  "message",
  "errors",
  "clerk_error",
];

const OAUTH_PAYLOAD_PARAMS = [
  "code",
  "state",
  "ticket",
  "__clerk_status",
  "__clerk_created_session",
  "__clerk_handshake",
  "__clerk_synced",
];

function hasCallbackPayload(searchParams: URLSearchParams) {
  return OAUTH_PAYLOAD_PARAMS.some((param) => searchParams.has(param));
}

function getCallbackError(searchParams: URLSearchParams) {
  for (const param of OAUTH_ERROR_PARAMS) {
    const value = searchParams.get(param);
    if (value) return value;
  }

  const status = searchParams.get("status");
  if (status === "error" || status === "failed" || status === "cancelled") {
    return status;
  }

  return null;
}

function oauthMessage(rawError: string) {
  const normalized = rawError.toLowerCase();
  if (
    normalized.includes("access_denied") ||
    normalized.includes("cancel") ||
    normalized.includes("denied") ||
    normalized.includes("unauthorized")
  ) {
    return "OAuth sign-in was canceled.";
  }

  return "OAuth sign-in could not be completed.";
}

export default function SsoCallbackPage() {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const callbackError = getCallbackError(new URLSearchParams(window.location.search));
    if (!callbackError) {
      const searchParams = new URLSearchParams(window.location.search);
      if (hasCallbackPayload(searchParams)) {
        setIsReady(true);
        return;
      }

      const nextParams = new URLSearchParams({
        oauth_error: "OAuth sign-in was canceled.",
      });
      setError("missing_callback_payload");
      router.replace(`/sign-in?${nextParams.toString()}`);
      return;
    }

    const nextParams = new URLSearchParams({
      oauth_error: oauthMessage(callbackError),
    });
    setError(callbackError);
    router.replace(`/sign-in?${nextParams.toString()}`);
  }, [router]);

  if (error || !isReady) {
    return (
      <main className="bg-bg text-text flex min-h-dvh items-center justify-center px-6">
        <p className="text-faint text-sm">Returning to sign in...</p>
      </main>
    );
  }

  return <AuthenticateWithRedirectCallback />;
}
