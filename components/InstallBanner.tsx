"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallBanner() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // Not available on iOS, already installed, or user dismissed.
  if (!prompt || dismissed) return null;

  return (
    <div
      className="bg-surface border-hairline fixed inset-x-4 bottom-24 z-50 mx-auto max-w-md rounded-card border p-4"
      style={{ boxShadow: "0 20px 60px rgba(0,0,0,.5)" }}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-text font-semibold">Install Unveil</p>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-faint hover:text-text"
          aria-label="Dismiss"
        >
          <X size={18} />
        </button>
      </div>
      <p className="text-muted mt-1 text-[13px]">
        Add to your home screen for the full app.
      </p>
      <button
        type="button"
        onClick={async () => {
          await prompt.prompt();
          setPrompt(null);
        }}
        className="bg-primary text-primary-fg mt-3 w-full rounded-pill py-2.5 font-semibold transition-transform duration-[140ms] ease-[var(--ease-veil)] active:scale-[0.98]"
      >
        Add to Home Screen
      </button>
    </div>
  );
}
