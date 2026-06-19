"use client";

import { useEffect, useRef, type RefObject } from "react";

type VideoRef = RefObject<HTMLVideoElement | null>;

// rVFC isn't in older TS DOM libs — narrow locally.
type RVFCVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

const DRIFT_S = 0.05; // 50ms — below this, leave the patch alone

/**
 * Lock a set of overlay <video> "patches" to a base "clock" video. The base owns
 * transport; patches mirror play/pause/seek/rate and have their currentTime
 * corrected each frame via requestVideoFrameCallback (fallback rAF). Over an 8s
 * clip drift is tiny, but this keeps a revealed region pixel-aligned to the clip.
 *
 * `getPatches` is read live (through a ref) so patches mounted *after* a region
 * unlock are picked up without re-running the effect.
 */
export function useMediaSync(baseRef: VideoRef, getPatches: () => HTMLVideoElement[]) {
  const getPatchesRef = useRef(getPatches);
  getPatchesRef.current = getPatches;

  useEffect(() => {
    const base = baseRef.current as RVFCVideo | null;
    if (!base) return;
    const patches = () => getPatchesRef.current();

    const wrap = (t: number, p: HTMLVideoElement) =>
      t % (p.duration || base.duration || 1);

    const onPlay = () => patches().forEach((p) => p.play().catch(() => {}));
    const onPause = () => patches().forEach((p) => p.pause());
    const onSeek = () =>
      patches().forEach((p) => {
        p.currentTime = wrap(base.currentTime, p);
      });
    const onRate = () => patches().forEach((p) => (p.playbackRate = base.playbackRate));

    base.addEventListener("play", onPlay);
    base.addEventListener("pause", onPause);
    base.addEventListener("seeked", onSeek);
    base.addEventListener("ratechange", onRate);

    let handle = 0;
    let raf = 0;
    const useRvfc = typeof base.requestVideoFrameCallback === "function";
    const tick = () => {
      const t = base.currentTime;
      patches().forEach((p) => {
        const target = wrap(t, p);
        if (Math.abs(p.currentTime - target) > DRIFT_S) p.currentTime = target;
      });
      schedule();
    };
    const schedule = () => {
      if (useRvfc) handle = base.requestVideoFrameCallback!(tick);
      else raf = requestAnimationFrame(tick);
    };
    schedule();

    return () => {
      base.removeEventListener("play", onPlay);
      base.removeEventListener("pause", onPause);
      base.removeEventListener("seeked", onSeek);
      base.removeEventListener("ratechange", onRate);
      if (useRvfc && handle) base.cancelVideoFrameCallback?.(handle);
      else if (raf) cancelAnimationFrame(raf);
    };
  }, [baseRef]);
}
