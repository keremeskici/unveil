"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Lock } from "lucide-react";
import { formatUsd } from "@/lib/constants";
import { useRegionUnlock } from "./useRegionUnlock";
import { useMediaSync } from "./useMediaSync";

export type PartialRegion = {
  id: string;
  rect: { x: number; y: number; w: number; h: number }; // normalized 0..1 of source frame
  unlocked: boolean;
  patchUrl: string | null; // presigned iff already owned
};

type Box = { left: number; top: number; width: number; height: number };

/**
 * Partial-reveal player. The fully-blurred clip plays free and is the master
 * clock; each region is a $-priced overlay. Tapping pays for one region and a
 * clean crop fades in over it, kept frame-synced to the base via useMediaSync.
 *
 * Region rects are normalized to the *source* frame, so we map them through the
 * same object-cover transform the base video uses (no extra scale on the base,
 * or the math drifts). Recomputed on metadata load and resize.
 */
export function PartialVideoStage({
  postId,
  previewUrl,
  price,
  regions,
  poster,
}: {
  postId: string;
  previewUrl: string;
  price: string;
  regions: PartialRegion[];
  poster?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLVideoElement>(null);
  const patchEls = useRef<Map<string, HTMLVideoElement>>(new Map());
  const [cover, setCover] = useState<{
    scale: number;
    offX: number;
    offY: number;
    srcW: number;
    srcH: number;
  } | null>(null);

  // regionId → signed clean-crop URL, seeded with regions already owned.
  const [revealed, setRevealed] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const r of regions) if (r.unlocked && r.patchUrl) init[r.id] = r.patchUrl;
    return init;
  });

  const getPatches = useCallback(
    () => Array.from(patchEls.current.values()),
    [],
  );
  useMediaSync(baseRef, getPatches);

  // Cover transform: source pixels → container pixels.
  const recompute = useCallback(() => {
    const c = containerRef.current;
    const v = baseRef.current;
    if (!c || !v || !v.videoWidth || !v.videoHeight) return;
    const boxW = c.clientWidth;
    const boxH = c.clientHeight;
    const scale = Math.max(boxW / v.videoWidth, boxH / v.videoHeight);
    setCover({
      scale,
      offX: (boxW - v.videoWidth * scale) / 2,
      offY: (boxH - v.videoHeight * scale) / 2,
      srcW: v.videoWidth,
      srcH: v.videoHeight,
    });
  }, []);

  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const ro = new ResizeObserver(recompute);
    ro.observe(c);
    return () => ro.disconnect();
  }, [recompute]);

  // Play the base only while on-screen.
  useEffect(() => {
    const el = baseRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && e.intersectionRatio > 0.6) el.play().catch(() => {});
        else el.pause();
      },
      { threshold: [0, 0.6, 1] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const boxFor = (r: PartialRegion["rect"]): Box | null => {
    if (!cover) return null;
    return {
      left: cover.offX + r.x * cover.srcW * cover.scale,
      top: cover.offY + r.y * cover.srcH * cover.scale,
      width: r.w * cover.srcW * cover.scale,
      height: r.h * cover.srcH * cover.scale,
    };
  };

  return (
    <div
      ref={containerRef}
      className="relative mx-3 overflow-hidden rounded-md"
      style={{ aspectRatio: "4 / 5" }}
    >
      {/* Free, fully-blurred clip — the master clock. No scale transform: it would
          throw off the region geometry. */}
      <video
        ref={baseRef}
        src={previewUrl}
        poster={poster}
        muted
        loop
        playsInline
        preload="metadata"
        onLoadedMetadata={recompute}
        className="absolute inset-0 h-full w-full object-cover"
        style={{ filter: "blur(14px)" }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(160deg,rgba(255,255,255,.07),transparent 38%)",
        }}
      />

      {regions.map((r) => {
        const box = boxFor(r.rect);
        if (!box) return null;
        const url = revealed[r.id];
        return url ? (
          <RegionPatch
            key={r.id}
            box={box}
            url={url}
            register={(el) => {
              if (el) patchEls.current.set(r.id, el);
              else patchEls.current.delete(r.id);
            }}
          />
        ) : (
          <RegionGate
            key={r.id}
            postId={postId}
            regionId={r.id}
            price={price}
            box={box}
            onUnlock={(signedUrl) =>
              setRevealed((m) => ({ ...m, [r.id]: signedUrl }))
            }
          />
        );
      })}

      {/* Free-to-watch hint. */}
      <div
        className="pointer-events-none absolute bottom-3 left-3 rounded-pill px-2.5 py-1 text-[11px] font-medium"
        style={{ background: "rgba(8,6,8,.55)", backdropFilter: "blur(4px)" }}
      >
        Plays free · tap a blurred area to reveal
      </div>
    </div>
  );
}

function RegionPatch({
  box,
  url,
  register,
}: {
  box: Box;
  url: string;
  register: (el: HTMLVideoElement | null) => void;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className="absolute overflow-hidden rounded-[3px]"
      style={{ ...box }}
      initial={reduce ? { opacity: 0 } : { opacity: 0, filter: "blur(12px)" }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, filter: "blur(0px)" }}
      transition={{ duration: reduce ? 0.3 : 0.55, ease: [0.22, 1, 0.36, 1] }}
    >
      <video
        ref={register}
        src={url}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        className="h-full w-full object-cover"
      />
    </motion.div>
  );
}

function RegionGate({
  postId,
  regionId,
  price,
  box,
  onUnlock,
}: {
  postId: string;
  regionId: string;
  price: string;
  box: Box;
  onUnlock: (signedUrl: string) => void;
}) {
  const { state, unlock } = useRegionUnlock(postId, regionId, {
    onUnlock,
  });
  const pending = state === "pending";

  return (
    <button
      type="button"
      onClick={unlock}
      disabled={pending}
      aria-label={`Reveal this area for $${formatUsd(price)}`}
      className="absolute flex items-center justify-center transition-transform duration-[140ms] active:scale-[0.97]"
      style={{ ...box }}
    >
      {/* Tap target outline over the blurred region. */}
      <span
        className="absolute inset-0 rounded-[3px]"
        style={{ border: "1.5px dashed rgba(255,255,255,.5)", background: "rgba(8,6,8,.18)" }}
      />
      <span
        className="bg-primary text-primary-fg relative flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-[13px] font-semibold"
        style={{ boxShadow: "0 6px 20px var(--primary-glow)" }}
      >
        {pending ? (
          <span
            aria-hidden
            className="size-[14px] rounded-full border-2 border-white/35 border-t-white"
            style={{ animation: "vspin 0.7s linear infinite" }}
          />
        ) : (
          <Lock size={13} strokeWidth={2.4} />
        )}
        <span className="tabular">${formatUsd(price)}</span>
      </span>
    </button>
  );
}
