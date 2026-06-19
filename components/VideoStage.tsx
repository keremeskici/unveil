"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Play, Volume2, VolumeX } from "lucide-react";

/**
 * Video counterpart to <RevealMedia>. The blurred base clip autoplays muted as a
 * teaser while locked (only while on-screen — we don't run every feed video at
 * once). On reveal the clean clip springs in over it: blur(15px)→0, scale 1.06→1,
 * opacity 0→1, same crimson shimmer, carrying the base's playback position so the
 * swap is seamless. Respects prefers-reduced-motion. Server still owns gating —
 * the clean source only arrives post-payment via a signed URL.
 */
export function VideoStage({
  previewUrl,
  revealedUrl,
  revealed,
  poster,
  overlay,
}: {
  previewUrl: string;
  revealedUrl: string | null;
  revealed: boolean;
  poster?: string;
  overlay?: ReactNode;
}) {
  const reduce = useReducedMotion();
  const baseRef = useRef<HTMLVideoElement>(null);
  const cleanRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(false);

  const showClean = revealed && revealedUrl;

  // Play only while on-screen — a feed of autoplaying videos murders battery and
  // piles up decoders. IntersectionObserver drives the currently-active element.
  useEffect(() => {
    const el = showClean ? cleanRef.current : baseRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && entry.intersectionRatio > 0.6) {
          el.play().catch(() => {});
        } else {
          el.pause();
        }
      },
      { threshold: [0, 0.6, 1] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [showClean]);

  // On reveal, start the clean clip where the teaser left off so there's no jump.
  useEffect(() => {
    if (!showClean) return;
    const base = baseRef.current;
    const clean = cleanRef.current;
    if (!clean) return;
    const sync = () => {
      if (base && Number.isFinite(base.currentTime)) {
        clean.currentTime = base.currentTime % (clean.duration || 1);
      }
      clean.play().catch(() => {});
      // The teaser is now fully covered — stop decoding it.
      base?.pause();
    };
    if (clean.readyState >= 1) sync();
    else clean.addEventListener("loadedmetadata", sync, { once: true });
  }, [showClean]);

  const togglePlay = () => {
    const el = showClean ? cleanRef.current : baseRef.current;
    if (!el) return;
    if (el.paused) {
      el.play().catch(() => {});
      setPaused(false);
    } else {
      el.pause();
      setPaused(true);
    }
  };

  return (
    <div
      className="feed-media relative mx-3 overflow-hidden rounded-md"
      style={{ aspectRatio: "4 / 5" }}
    >
      {/* Blurred base teaser — always underneath. */}
      <video
        ref={baseRef}
        src={previewUrl}
        poster={poster}
        muted
        loop
        playsInline
        preload="metadata"
        className="absolute inset-0 h-full w-full object-cover"
        style={{ filter: "blur(15px)", transform: "scale(1.1)" }}
      />
      {/* Soft top gloss. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(160deg,rgba(255,255,255,.07),transparent 38%)",
        }}
      />

      {/* Revealed clean clip springs in over the teaser. */}
      {showClean && (
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
            <video
              ref={cleanRef}
              src={revealedUrl}
              muted={muted}
              loop
              playsInline
              preload="auto"
              onClick={togglePlay}
              className="h-full w-full object-cover"
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

          {/* Sound toggle — the unlock tap can't carry through async settlement to
              an unmuted autoplay, so we reveal muted and let the fan opt into audio. */}
          <button
            type="button"
            onClick={() => {
              setMuted((m) => !m);
              const el = cleanRef.current;
              if (el) el.muted = !el.muted;
            }}
            aria-label={muted ? "Unmute" : "Mute"}
            className="absolute right-3 bottom-3 flex size-9 items-center justify-center rounded-full"
            style={{ background: "rgba(8,6,8,.55)", backdropFilter: "blur(4px)" }}
          >
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>

          {/* Paused affordance. */}
          {paused && (
            <button
              type="button"
              onClick={togglePlay}
              aria-label="Play"
              className="absolute inset-0 flex items-center justify-center"
            >
              <span
                className="flex size-[58px] items-center justify-center rounded-full"
                style={{ background: "rgba(8,6,8,.55)", backdropFilter: "blur(4px)" }}
              >
                <Play size={26} className="translate-x-[1px]" fill="currentColor" />
              </span>
            </button>
          )}
        </>
      )}

      {/* Lock / unlock overlay (only while gated). */}
      {!revealed && overlay}
    </div>
  );
}
