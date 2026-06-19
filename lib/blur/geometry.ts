import type { DetectedRegion, RegionRect } from "@/lib/db/schema";

type Box = [number, number, number, number]; // [x1, y1, x2, y2]
type PxRect = { x: number; y: number; w: number; h: number };

function unionBox(a: Box, b: Box): Box {
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[2], b[2]),
    Math.max(a[3], b[3]),
  ];
}

function iou(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const areaA = (a[2] - a[0]) * (a[3] - a[1]);
  const areaB = (b[2] - b[0]) * (b[3] - b[1]);
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Collapse detected boxes into a few stable regions: strongest-first, merging
 * any box that meaningfully overlaps one already kept (so duplicate/jittery
 * detections of the same area become one). Caps at `maxN`.
 */
export function clusterBoxes(
  regions: DetectedRegion[],
  maxN = 3,
): { label: string; box: Box }[] {
  const sorted = [...regions].sort((a, b) => b.confidence - a.confidence);
  const merged: { label: string; box: Box }[] = [];
  for (const r of sorted) {
    const hit = merged.find((m) => iou(m.box, r.box) > 0.4);
    if (hit) hit.box = unionBox(hit.box, r.box);
    else merged.push({ label: r.label, box: [...r.box] as Box });
  }
  return merged.slice(0, maxN);
}

/**
 * Pad a box by `padFrac` (to give a moving region headroom over the clip),
 * clamp to the frame, and snap offset + size to even numbers — yuv420p requires
 * even crop dimensions or ffmpeg fails.
 */
export function padClampEven(
  box: Box,
  padFrac: number,
  srcW: number,
  srcH: number,
): PxRect {
  const [x1, y1, x2, y2] = box;
  const px = (x2 - x1) * padFrac;
  const py = (y2 - y1) * padFrac;

  let nx = Math.max(0, Math.round(x1 - px));
  let ny = Math.max(0, Math.round(y1 - py));
  const ex = Math.min(srcW, Math.round(x2 + px));
  const ey = Math.min(srcH, Math.round(y2 + py));
  if (nx % 2) nx -= 1;
  if (ny % 2) ny -= 1;

  let w = ex - nx;
  let h = ey - ny;
  if (w % 2) w -= 1;
  if (h % 2) h -= 1;
  // Final clamp so nx+w / ny+h never exceed the frame.
  w = Math.min(w, srcW - nx);
  h = Math.min(h, srcH - ny);
  if (w % 2) w -= 1;
  if (h % 2) h -= 1;

  return { x: nx, y: ny, w, h };
}

export function toNormalizedRect(
  r: PxRect,
  srcW: number,
  srcH: number,
): RegionRect {
  return { x: r.x / srcW, y: r.y / srcH, w: r.w / srcW, h: r.h / srcH };
}

// CRITICAL: sam-2-video takes click POINTS [x,y], not boxes (PRD §13). Convert
// each detected box to its center point and emit the parallel arrays sam-2-video
// expects. Verified against the live model schema (2026-06-18):
//   click_coordinates: "[x,y],[x,y],..."   (determines the number of clicks)
//   click_frames:      "0,30,..."           (frame index per click)
//   click_labels:      "1,1,..."            (1 = foreground / include)
//   click_object_ids:  "breast_0,..."       (distinct id per tracked region)
export function regionsToSam2Clicks(regions: DetectedRegion[]) {
  const coords: string[] = [];
  const frames: number[] = [];
  const labels: number[] = [];
  const objectIds: string[] = [];

  regions.forEach((r, i) => {
    const [x1, y1, x2, y2] = r.box;
    const cx = Math.round((x1 + x2) / 2);
    const cy = Math.round((y1 + y2) / 2);
    coords.push(`[${cx},${cy}]`);
    frames.push(r.frame ?? 0);
    labels.push(1);
    objectIds.push(`${r.label}_${i}`);
  });

  return {
    click_coordinates: coords.join(","),
    click_frames: frames.join(","),
    click_labels: labels.join(","),
    click_object_ids: objectIds.join(","),
  };
}
