"use client";

import Image from "next/image";
import type { ReactNode } from "react";

/**
 * The hero animation wrapper. Locked → blurred preview behind an overlay.
 * On reveal the full media springs in via CSS: blur(15px)→0, scale(1.06)→1,
 * opacity 0→1, with a one-shot crimson shimmer sweep. Respects
 * prefers-reduced-motion (instant reveal, shimmer hidden) — see globals.css.
 * Server still owns gating — the real asset only arrives post-payment via a
 * signed URL.
 */
export function RevealMedia({
  previewUrl,
  revealedUrl,
  revealed,
  alt,
  overlay,
  priority = false,
  animateReveal = true,
}: {
  previewUrl: string;
  revealedUrl: string | null;
  revealed: boolean;
  alt: string;
  overlay?: ReactNode;
  priority?: boolean;
  animateReveal?: boolean;
}) {
  return (
    <div
      className="feed-media relative mx-3 overflow-hidden rounded-md"
      style={{ aspectRatio: "4 / 5" }}
    >
      {/* Blurred preview — always underneath. Optimized (resized + AVIF/WebP):
          it's the LCP element, and displayed under a 15px blur so q=50 is
          invisible. `preload` replaces the deprecated `priority` in Next 16. */}
      <Image
        src={previewUrl}
        alt={revealed ? "" : alt}
        fill
        sizes="(max-width: 768px) 100vw, 412px"
        quality={50}
        className="object-cover"
        style={{ filter: "blur(15px)", transform: "scale(1.1)" }}
        preload={priority}
      />
      {/* Soft top gloss. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "linear-gradient(160deg,rgba(255,255,255,.07),transparent 38%)" }}
      />

      {/* Revealed full media springs in over the preview (CSS, see globals.css). */}
      {revealed && revealedUrl && (
        <>
          <div className={animateReveal ? "motion-reveal absolute inset-0" : "absolute inset-0"}>
            <Image
              src={revealedUrl}
              alt={alt}
              fill
              sizes="(max-width: 768px) 100vw, 412px"
              className="object-cover"
              unoptimized
            />
          </div>
          {animateReveal && (
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <div
                className="motion-shimmer absolute top-0 bottom-0"
                style={{
                  width: "55%",
                  background:
                    "linear-gradient(105deg,transparent,rgba(216,27,71,.5) 45%,rgba(255,210,224,.85) 50%,rgba(216,27,71,.5) 55%,transparent)",
                  mixBlendMode: "screen",
                  animation: "vshimmer .85s cubic-bezier(.22,1,.36,1) .08s 1 both",
                }}
              />
            </div>
          )}
        </>
      )}

      {/* Lock / unlock overlay (only while gated). */}
      {!revealed && overlay}
    </div>
  );
}
