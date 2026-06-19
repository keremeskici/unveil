"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppAuth } from "./useAppAuth";

export type RegionUnlockState = "locked" | "pending" | "unlocked" | "error";

function haptic(pattern: number | number[]) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      /* unsupported — non-fatal */
    }
  }
}

/**
 * Per-region sibling of useUnlock. Pays the post's single price for ONE region
 * and hands back a signed URL for that region's clean crop.
 */
export function useRegionUnlock(
  postId: string,
  regionId: string,
  opts?: { onUnlock?: (signedUrl: string, settlementMs: number) => void },
) {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAppAuth();
  const [state, setState] = useState<RegionUnlockState>("locked");
  const [error, setError] = useState<string | null>(null);

  const unlock = useCallback(async () => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      router.push("/sign-in");
      return;
    }

    setState("pending");
    setError(null);
    haptic(8);

    try {
      const started = Date.now();
      const res = await fetch("/api/unlock/region", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId, regionId, settlementStartedAt: started }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          settlementError?: string;
        };
        if (body.error === "Settlement failed") {
          throw new Error(
            body.settlementError
              ? `Tempo settlement failed: ${body.settlementError}`
              : "Tempo settlement failed",
          );
        }
        throw new Error(body.error ?? "Unlock failed");
      }

      const { signedUrl, settlementMs } = (await res.json()) as {
        signedUrl: string;
        settlementMs: number;
      };
      setState("unlocked");
      haptic([6, 40, 12]);
      window.dispatchEvent(new Event("veil:balance-changed"));
      opts?.onUnlock?.(signedUrl, settlementMs);
    } catch (err) {
      console.error("[region-unlock] failed:", err);
      setState("error");
      setError(err instanceof Error ? err.message : "Couldn't reveal that area.");
    }
  }, [isLoaded, isSignedIn, opts, postId, regionId, router]);

  return { state, error, unlock };
}
