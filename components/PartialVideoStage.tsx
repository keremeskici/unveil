"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Lock } from "lucide-react";
import { formatUsd } from "@/lib/constants";
import { useRegionUnlock } from "./useRegionUnlock";
import { useMediaSync } from "./useMediaSync";

type Rect = { x: number; y: number; w: number; h: number }; // normalized 0..1
type TrackPoint = { t: number; rect: Rect };

export type PartialRegion = {
  id: string;
  rect: Rect; // union bbox over the clip, normalized 0..1 of source frame
  // Per-frame position track so the tap-button can follow the moving area.
  // Null/absent → the button sits on the static union rect (legacy behaviour).
  track?: TrackPoint[] | null;
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
 *
 * When a region carries a `track`, its tap-button follows the blurred area
 * frame-by-frame: a rAF loop interpolates the track at the base video's
 * currentTime and moves the button's wrapper imperatively (no React re-render
 * per frame). The revealed clean crop still sits on the static union rect.
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
  // Wrappers for locked region buttons — moved imperatively by the rAF loop.
  const gateEls = useRef<Map<string, HTMLDivElement>>(new Map());
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

  const boxFor = useCallback(
    (r: Rect): Box | null => {
      if (!cover) return null;
      return {
        left: cover.offX + r.x * cover.srcW * cover.scale,
        top: cover.offY + r.y * cover.srcH * cover.scale,
        width: r.w * cover.srcW * cover.scale,
        height: r.h * cover.srcH * cover.scale,
      };
    },
    [cover],
  );

  // Drive the tracked buttons: each frame, interpolate the region's track at the
  // base video's time and write the wrapper's box. Locked + tracked regions only.
  useEffect(() => {
    if (!cover) return;
    const tracked = regions.filter(
      (r) => r.track && r.track.length > 0 && !revealed[r.id],
    );
    if (tracked.length === 0) return;

    let raf = 0;
    const tick = () => {
      const v = baseRef.current;
      if (v && v.videoWidth) {
        const t = v.currentTime;
        for (const r of tracked) {
          const el = gateEls.current.get(r.id);
          if (!el) continue;
          const rect = sampleTrack(r.track!, t);
          const box = rect && boxFor(rect);
          if (!box) {
            el.style.visibility = "hidden";
            continue;
          }
          el.style.visibility = "visible";
          el.style.left = `${box.left}px`;
          el.style.top = `${box.top}px`;
          el.style.width = `${box.width}px`;
          el.style.height = `${box.height}px`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [regions, revealed, cover, boxFor]);

  return (
    <div
      ref={containerRef}
      className="feed-media relative mx-3 overflow-hidden rounded-md"
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
        // Static union box: the revealed crop's position, and the button's
        // fallback when there's no per-frame track.
        const staticBox = boxFor(r.rect);
        if (!staticBox) return null;
        const url = revealed[r.id];
        if (url) {
          return (
            <RegionPatch
              key={r.id}
              box={staticBox}
              url={url}
              register={(el) => {
                if (el) patchEls.current.set(r.id, el);
                else patchEls.current.delete(r.id);
              }}
            />
          );
        }
        const tracked = !!(r.track && r.track.length > 0);
        return (
          <div
            key={r.id}
            ref={(el) => {
              if (el) gateEls.current.set(r.id, el);
              else gateEls.current.delete(r.id);
            }}
            className="absolute"
            // Initial box; the rAF loop owns it for tracked regions thereafter.
            style={staticBox}
          >
            <RegionGate
              postId={postId}
              regionId={r.id}
              price={price}
              tracked={tracked}
              onUnlock={(signedUrl) =>
                setRevealed((m) => ({ ...m, [r.id]: signedUrl }))
              }
            />
          </div>
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

/** Interpolate a region's position track at time `t` (seconds). Clamps to the
 *  ends; returns null only for an empty track. */
function sampleTrack(track: TrackPoint[], t: number): Rect | null {
  if (track.length === 0) return null;
  if (t <= track[0].t) return track[0].rect;
  const last = track[track.length - 1];
  if (t >= last.t) return last.rect;
  let i = 1;
  while (i < track.length && track[i].t < t) i++;
  const a = track[i - 1];
  const b = track[i];
  const span = b.t - a.t || 1;
  const f = (t - a.t) / span;
  return {
    x: a.rect.x + (b.rect.x - a.rect.x) * f,
    y: a.rect.y + (b.rect.y - a.rect.y) * f,
    w: a.rect.w + (b.rect.w - a.rect.w) * f,
    h: a.rect.h + (b.rect.h - a.rect.h) * f,
  };
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
  return (
    <div
      className="motion-patch absolute overflow-hidden rounded-[3px]"
      style={{ ...box }}
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
    </div>
  );
}

function RegionGate({
  postId,
  regionId,
  price,
  tracked,
  onUnlock,
}: {
  postId: string;
  regionId: string;
  price: string;
  tracked: boolean;
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
      className="absolute inset-0 flex items-center justify-center transition-transform duration-[140ms] active:scale-[0.97]"
    >
      {/* Tap target outline over the blurred region. A solid ring while it
          tracks the moving area reads as "this follows the blur". */}
      <span
        className="absolute inset-0 rounded-[3px]"
        style={{
          border: tracked
            ? "1.5px solid rgba(255,255,255,.7)"
            : "1.5px dashed rgba(255,255,255,.5)",
          background: "rgba(8,6,8,.18)",
        }}
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
