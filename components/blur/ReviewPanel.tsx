"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, RotateCcw, UserCog, CircleCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { RegionOverlay } from "./RegionOverlay";
import { BlurProgress } from "./BlurProgress";
import type { DetectedRegion } from "@/lib/db/schema";

const PROCESSING = ["uploaded", "detecting", "tracking", "compositing"];
const RETRYABLE = ["failed", "manual_review"];
// A job that hasn't even left `uploaded` after this long never started — its
// kickoff was almost certainly lost. Surface a manual retry instead of an
// endless spinner (the reconcile cron also recovers it, but far less promptly).
const STALL_MS = 12_000;

type Action = "approve" | "adjust" | "manual" | "retry";

export function ReviewPanel({
  jobId,
  status,
  mediaType,
  previewUrl,
  regions,
  confidence,
}: {
  jobId: string;
  status: string;
  mediaType: "image" | "video";
  previewUrl: string | null;
  regions: DetectedRegion[];
  confidence: string | null;
}) {
  const router = useRouter();
  const [state, setState] = useState(status);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stalled, setStalled] = useState(false);

  const reviewable = state === "ready_for_review";
  // Offer a retry on terminal-but-failed states, or on a kickoff that stalled.
  const canRetry = RETRYABLE.includes(state) || (state === "uploaded" && stalled);

  // Flag a job that's still `uploaded` after the stall window so the creator
  // gets an escape hatch rather than a forever-spinner.
  useEffect(() => {
    setStalled(false);
    if (state !== "uploaded") return;
    const t = setTimeout(() => setStalled(true), STALL_MS);
    return () => clearTimeout(t);
  }, [state]);

  // While the pipeline is still running, poll until it reaches a terminal state,
  // then refresh so the server re-presigns the freshly-composited preview.
  useEffect(() => {
    if (!PROCESSING.includes(state)) return;
    const iv = setInterval(async () => {
      try {
        const r = await fetch(`/api/blur/jobs/${jobId}`);
        const d = (await r.json()) as { status?: string };
        if (d.status && d.status !== state) {
          setState(d.status);
          if (!PROCESSING.includes(d.status)) router.refresh();
        }
      } catch {
        /* transient — keep polling */
      }
    }, 3000);
    return () => clearInterval(iv);
  }, [state, jobId, router]);

  async function run(action: Action) {
    setBusy(action);
    setError(null);
    try {
      const url =
        action === "approve"
          ? `/api/blur/jobs/${jobId}/approve`
          : action === "retry"
            ? `/api/blur/jobs/${jobId}/retry`
            : `/api/blur/jobs/${jobId}/reject`;
      // approve/retry take no body; reject carries its mode (adjust | manual).
      const body = action === "approve" || action === "retry" ? {} : { mode: action };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setState(data.status);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-[480px] px-4 pt-6 pb-24">
      <header className="mb-4">
        <p className="text-faint text-[12.5px] tracking-wide uppercase">Blur review</p>
        <h1 className="text-text text-[22px] font-semibold">Approve before publishing</h1>
        <p className="text-muted mt-1 text-[13.5px] leading-relaxed">
          Nothing goes public until you approve. Check that every explicit region
          is covered.
        </p>
      </header>

      {/* Status pill */}
      <div className="mb-4 flex items-center gap-2">
        <StatusPill state={state} />
        {confidence && (
          <span className="text-faint text-[12px]">
            coverage/conf {Number(confidence).toFixed(3)}
          </span>
        )}
      </div>

      {/* Preview */}
      <div className="bg-surface-2 rounded-card overflow-hidden p-3" style={{ boxShadow: "var(--shadow-card)" }}>
        {previewUrl ? (
          mediaType === "video" ? (
            <video
              src={previewUrl}
              controls
              playsInline
              className="w-full rounded-md"
            />
          ) : (
            <RegionOverlay src={previewUrl} regions={regions} alt="Blurred preview" />
          )
        ) : PROCESSING.includes(state) && !(state === "uploaded" && stalled) ? (
          <BlurProgress status={state} mediaType={mediaType} />
        ) : (
          <div className="text-faint flex aspect-[4/5] items-center justify-center text-[13px]">
            No preview yet
          </div>
        )}

        {/* Region list */}
        {regions.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {regions.map((r, i) => (
              <li
                key={i}
                className="text-muted rounded-pill bg-surface-3 px-2.5 py-1 text-[12px]"
              >
                {r.label} · {Math.round(r.confidence * 100)}%
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <p className="text-danger mt-3 flex items-center gap-1.5 text-[13px]">
          <TriangleAlert size={15} /> {error}
        </p>
      )}

      {/* Actions */}
      {reviewable ? (
        <div className="mt-5 flex flex-col gap-2.5">
          <Button onClick={() => run("approve")} loading={busy === "approve"} disabled={!!busy}>
            <ShieldCheck size={18} /> Approve & publish
          </Button>
          <div className="flex gap-2.5">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => run("adjust")}
              loading={busy === "adjust"}
              disabled={!!busy}
            >
              <RotateCcw size={17} /> Re-run stronger
            </Button>
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => run("manual")}
              loading={busy === "manual"}
              disabled={!!busy}
            >
              <UserCog size={17} /> Manual
            </Button>
          </div>
        </div>
      ) : canRetry ? (
        <div className="mt-5 flex flex-col gap-3">
          <RetryReason state={state} stalled={stalled} />
          <Button onClick={() => run("retry")} loading={busy === "retry"} disabled={!!busy}>
            <RotateCcw size={18} /> Retry auto-blur
          </Button>
        </div>
      ) : (
        <div className="mt-5">
          <ResultBanner state={state} />
        </div>
      )}
    </main>
  );
}

function RetryReason({ state, stalled }: { state: string; stalled: boolean }) {
  const msg =
    state === "failed"
      ? "Auto-blur failed before it finished."
      : state === "manual_review"
        ? "Sent to manual review — you can run the auto-blur again."
        : stalled
          ? "Processing didn’t start — the service may have been briefly unavailable."
          : "Processing didn’t finish.";
  return (
    <p className="text-muted flex items-center gap-2 text-[14px]">
      <TriangleAlert size={16} className="text-danger shrink-0" /> {msg}
    </p>
  );
}

function StatusPill({ state }: { state: string }) {
  const label = state.replace(/_/g, " ");
  const tone =
    state === "published"
      ? "var(--success)"
      : state === "manual_review" || state === "failed"
        ? "var(--danger)"
        : state === "ready_for_review"
          ? "var(--gold)"
          : "var(--text-muted)";
  return (
    <span
      className="rounded-pill px-2.5 py-1 text-[12px] font-semibold"
      style={{ color: tone, background: "color-mix(in srgb, " + tone + " 14%, transparent)" }}
    >
      {label}
    </span>
  );
}

function ResultBanner({ state }: { state: string }) {
  if (state === "published") {
    return (
      <p className="text-success flex items-center gap-2 text-[14px]">
        <CircleCheck size={18} /> Published — the blurred preview is now live in the feed.
      </p>
    );
  }
  if (PROCESSING.includes(state)) {
    // The BlurProgress stepper in the preview area already shows live progress.
    return null;
  }
  if (state === "manual_review") {
    return (
      <p className="text-danger flex items-center gap-2 text-[14px]">
        <UserCog size={16} /> Sent to manual review.
      </p>
    );
  }
  return <p className="text-muted text-[14px]">Status: {state.replace(/_/g, " ")}</p>;
}
