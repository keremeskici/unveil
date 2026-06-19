"use client";

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * Captures the PWA `beforeinstallprompt` event so any surface can offer an
 * "Add to Home Screen" action. `canInstall` is false on iOS / when already
 * installed / after the prompt is consumed, so callers can hide the affordance.
 */
export function useInstallPrompt() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  return {
    canInstall: prompt !== null,
    async promptInstall() {
      if (!prompt) return;
      await prompt.prompt();
      setPrompt(null);
    },
  };
}
