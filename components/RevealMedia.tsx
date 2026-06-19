"use client";

import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * The hero animation wrapper. Locked → blurred preview behind an overlay.
 * On reveal the full media springs in: blur(15px)→0, scale(1.06)→1, opacity
 * 0→1, with a one-shot crimson shimmer sweep. Respects prefers-reduced-motion
 * (plain cross-fade, no blur/scale/shimmer). Server still owns gating — the
 * real asset only arrives post-payment via a signed URL.
 */
export function RevealMedia({
  previewUrl,
  revealedUrl,
  revealed,
  alt,
  overlay,
  priority = false,
}: {
  previewUrl: string;
  revealedUrl: string | null;
  revealed: boolean;
  alt: string;
  overlay?: ReactNode;
  priority?: boolean;
}) {
  const reduce = useReducedMotion();

  return (
    <div
      className="feed-media relative mx-3 overflow-hidden rounded-md"
      style={{ aspectRatio: "4 / 5" }}
    >
      {/* Blurred preview — always underneath. */}
      <Image
        src={previewUrl}
        alt={revealed ? "" : alt}
        fill
        sizes="(max-width: 768px) 100vw, 412px"
        className="object-cover"
        style={{ filter: "blur(15px)", transform: "scale(1.1)" }}
        priority={priority}
        unoptimized
      />
      {/* Soft top gloss. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "linear-gradient(160deg,rgba(255,255,255,.07),transparent 38%)" }}
      />

      {/* Revealed full media springs in over the preview. */}
      {revealed && revealedUrl && (
        <>
          <motion.div
            className="absolute inset-0"
            initial={
              reduce
                ? { opacity: 0 }
                : { opacity: 0, filter: "blur(15px)", scale: 1.06 }
            }
            animate={
              reduce
                ? { opacity: 1 }
                : { opacity: 1, filter: "blur(0px)", scale: 1 }
            }
            transition={{ duration: reduce ? 0.3 : 0.62, ease: [0.22, 1, 0.36, 1] }}
          >
            <Image
              src={revealedUrl}
              alt={alt}
              fill
              sizes="(max-width: 768px) 100vw, 412px"
              className="object-cover"
              unoptimized
            />
          </motion.div>
          {!reduce && (
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
