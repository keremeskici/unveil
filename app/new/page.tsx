"use client";

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  Image as ImageIcon,
  Lock,
  RotateCcw,
  ShieldCheck,
  X,
} from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import { Button } from "@/components/ui/Button";
import { useAppAuth } from "@/components/useAppAuth";

type Screen = "compose" | "review";
type ReviewStage = "detecting" | "compositing" | "ready" | "uploading";

type DetectedBox = {
  label: string;
  confidence: number;
  left: string;
  top: string;
  width: string;
  height: string;
};

const DETECTED_BOXES: DetectedBox[] = [
  {
    label: "face",
    confidence: 97,
    left: "21%",
    top: "12%",
    width: "31%",
    height: "20%",
  },
  {
    label: "explicit",
    confidence: 94,
    left: "33%",
    top: "48%",
    width: "38%",
    height: "24%",
  },
];

const STAGES: { key: Exclude<ReviewStage, "uploading">; label: string }[] = [
  { key: "detecting", label: "Detecting sensitive regions" },
  { key: "compositing", label: "Applying the blur" },
  { key: "ready", label: "Preview ready" },
];

export default function NewPostPage() {
  const router = useRouter();
  const { isSignedIn } = useAppAuth();
  const fileInput = useRef<HTMLInputElement>(null);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  const [screen, setScreen] = useState<Screen>("compose");
  const [stage, setStage] = useState<ReviewStage>("detecting");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [price, setPrice] = useState("");
  const [autoBlur, setAutoBlur] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isVideo = file?.type.startsWith("video") ?? false;
  const canGoNext = !!file;
  const canPublish = !!file && stage === "ready";

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => () => clearDetectionTimers(), []);

  function clearDetectionTimers() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }

  function runDetection() {
    clearDetectionTimers();
    setError(null);
    setScreen("review");
    setStage("detecting");
    if (navigator.vibrate) navigator.vibrate(6);

    timers.current.push(
      setTimeout(() => setStage("compositing"), 900),
      setTimeout(() => {
        setStage("ready");
        if (navigator.vibrate) navigator.vibrate([5, 34, 10]);
      }, 1800),
    );
  }

  function pickMedia(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    if (!picked) return;
    clearDetectionTimers();
    setFile(picked);
    setError(null);
    setScreen("compose");
    setStage("detecting");
    e.target.value = "";
  }

  function next() {
    if (!file) {
      setError("Add media before starting review.");
      return;
    }
    runDetection();
  }

  async function publish() {
    setError(null);

    if (!file) {
      setError("Add media before publishing.");
      setScreen("compose");
      return;
    }
    if (stage !== "ready") return;
    if (isSignedIn !== true) {
      setError("Sign in from the feed to publish.");
      return;
    }

    setStage("uploading");
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("title", caption.trim() || "Untitled post");
      body.set("price", price.trim() || "0");

      const res = await fetch("/api/posts", { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        jobId?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Upload failed");

      if (data.jobId) {
        router.push(`/blur-review/${data.jobId}`);
      } else {
        router.push("/");
      }
    } catch (err) {
      setStage("ready");
      setError(err instanceof Error ? err.message : "Upload failed");
    }
  }

  return (
    <main className="flex min-h-dvh flex-1 flex-col">
      <header className="bg-surface/80 border-hairline pt-safe sticky top-0 z-40 border-b backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-md items-center justify-between px-[18px] py-3.5">
          <div className="flex items-center gap-3.5">
            {screen === "compose" ? (
              <Link
                href="/"
                aria-label="Back to feed"
                className="text-text flex size-[34px] items-center justify-center"
              >
                <ArrowLeft size={22} />
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => {
                  clearDetectionTimers();
                  setScreen("compose");
                  setError(null);
                }}
                aria-label="Back to compose"
                className="text-text flex size-[34px] items-center justify-center"
              >
                <ArrowLeft size={22} />
              </button>
            )}
            <h1 className="text-xl font-bold">New post</h1>
          </div>

          {screen === "compose" ? (
            <Button
              type="button"
              onClick={next}
              disabled={!canGoNext}
              className="!h-10 px-5 text-sm"
            >
              Next
            </Button>
          ) : (
            <Button
              type="button"
              onClick={publish}
              loading={stage === "uploading"}
              disabled={!canPublish}
              className="!h-10 px-5 text-sm"
            >
              Publish
            </Button>
          )}
        </div>
      </header>

      {screen === "compose" ? (
        <ComposeScreen
          autoBlur={autoBlur}
          caption={caption}
          error={error}
          isVideo={isVideo}
          previewUrl={previewUrl}
          price={price}
          onCaption={setCaption}
          onPick={() => fileInput.current?.click()}
          onPrice={setPrice}
          onRemove={() => {
            clearDetectionTimers();
            setFile(null);
            setPreviewUrl(null);
          }}
          onToggleAutoBlur={() => setAutoBlur((value) => !value)}
        />
      ) : (
        <ReviewScreen
          error={error}
          isVideo={isVideo}
          previewUrl={previewUrl}
          stage={stage}
          onApprove={publish}
          onRerun={runDetection}
        />
      )}

      <input
        ref={fileInput}
        hidden
        type="file"
        accept="image/*,video/*"
        onChange={pickMedia}
      />

      {screen === "compose" && <BottomNav />}
    </main>
  );
}

function ComposeScreen({
  autoBlur,
  caption,
  error,
  isVideo,
  previewUrl,
  price,
  onCaption,
  onPick,
  onPrice,
  onRemove,
  onToggleAutoBlur,
}: {
  autoBlur: boolean;
  caption: string;
  error: string | null;
  isVideo: boolean;
  previewUrl: string | null;
  price: string;
  onCaption: (value: string) => void;
  onPick: () => void;
  onPrice: (value: string) => void;
  onRemove: () => void;
  onToggleAutoBlur: () => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-[18px] pt-[18px] pb-28">
      <section className="mb-[18px] flex items-center gap-3">
        <span
          aria-hidden
          className="size-10 shrink-0 rounded-full"
          style={{ background: "conic-gradient(from 120deg,#3a3640,#1c1a22)" }}
        />
        <label className="min-w-0 flex-1">
          <span className="sr-only">Post caption</span>
          <textarea
            aria-label="Post caption"
            value={caption}
            onChange={(event) => onCaption(event.target.value)}
            placeholder="Write something worth unveiling..."
            rows={2}
            className="text-text placeholder:text-muted/70 mt-1 w-full resize-none bg-transparent text-[17px] leading-snug font-semibold outline-none"
          />
        </label>
      </section>

      <button
        type="button"
        onClick={onPick}
        className="border-hairline-strong text-muted relative flex aspect-square w-full flex-col items-center justify-center overflow-hidden rounded-[22px] border border-dashed bg-bg transition-transform active:scale-[0.99]"
        aria-label="Add media"
      >
        {previewUrl ? (
          <>
            <MediaPreview isVideo={isVideo} src={previewUrl} />
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onRemove();
              }}
              aria-label="Remove media"
              className="absolute top-3 right-3 flex size-10 items-center justify-center rounded-full text-white"
              style={{ background: "rgba(8,6,8,.62)", backdropFilter: "blur(8px)" }}
            >
              <X size={18} />
            </button>
          </>
        ) : (
          <>
            <ImageIcon size={34} strokeWidth={1.8} />
            <span className="tabular mt-4 text-[13.5px] font-semibold lowercase">
              add media
            </span>
          </>
        )}
      </button>

      <section className="bg-surface-2 mt-[18px] flex min-h-[76px] items-center justify-between gap-4 rounded-[18px] px-4">
        <div className="min-w-0">
          <h2 className="text-text text-[14.5px] leading-tight font-bold">
            Unlock price
          </h2>
          <p className="text-muted mt-1 text-[12.5px] leading-tight">
            Charged once per unlock
          </p>
        </div>

        <label
          className="border-hairline-strong text-text flex h-11 shrink-0 items-center gap-1 rounded-pill border border-dashed px-3.5"
          aria-label="Unlock price in dollars"
        >
          <span className="text-muted tabular text-[14px]">$</span>
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={price}
            onChange={(event) => onPrice(event.target.value)}
            placeholder="0"
            className="tabular placeholder:text-muted w-16 bg-transparent text-right text-[14px] font-semibold outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
        </label>
      </section>

      <button
        type="button"
        onClick={onToggleAutoBlur}
        aria-pressed={autoBlur}
        className="bg-surface-2 mt-3 flex min-h-[76px] items-center justify-between rounded-[18px] px-4 text-left transition-transform active:scale-[0.99]"
      >
        <span>
          <span className="text-text block text-[14.5px] leading-tight font-bold">
            Auto-blur
          </span>
          <span className="text-muted mt-1 block text-[12.5px] leading-tight">
            Detect & blur sensitive regions
          </span>
        </span>
        <span
          className="flex h-6 w-[42px] items-center rounded-pill p-0.5 transition-colors"
          style={{ background: autoBlur ? "var(--primary)" : "var(--surface-3)" }}
        >
          <span
            className="size-5 rounded-full bg-white transition-transform duration-200"
            style={{
              transform: autoBlur ? "translateX(18px)" : "translateX(0)",
              boxShadow: "0 2px 6px rgba(0,0,0,.3)",
            }}
          />
        </span>
      </button>

      {error && (
        <p className="text-danger mt-3 rounded-md bg-danger/10 px-3 py-2 text-[13px]">
          {error}
        </p>
      )}
    </div>
  );
}

function ReviewScreen({
  error,
  isVideo,
  previewUrl,
  stage,
  onApprove,
  onRerun,
}: {
  error: string | null;
  isVideo: boolean;
  previewUrl: string | null;
  stage: ReviewStage;
  onApprove: () => void;
  onRerun: () => void;
}) {
  const processing = stage === "detecting" || stage === "compositing";
  const ready = stage === "ready";
  const uploading = stage === "uploading";

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-[18px] pt-[18px] pb-8">
      <section className="border-hairline-strong relative aspect-square w-full overflow-hidden rounded-[22px] border bg-surface-2">
        {previewUrl ? (
          <MediaPreview isVideo={isVideo} src={previewUrl} />
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(120%_100%_at_30%_18%,rgba(124,49,72,.72),rgba(43,15,27,.86)_54%,rgba(16,9,14,.96))]" />
        )}

        {processing && (
          <div
            aria-hidden
            className="absolute inset-y-8 w-28 rounded-full opacity-80 blur-2xl"
            style={{
              background:
                "radial-gradient(circle at 50% 50%, rgba(245,242,243,.58), rgba(194,20,59,.34) 45%, transparent 72%)",
              animation: "scanBlob 1.7s var(--ease-out) infinite alternate",
              mixBlendMode: "screen",
            }}
          />
        )}

        <div className="absolute inset-0 bg-[linear-gradient(160deg,rgba(0,0,0,.18),transparent_44%,rgba(0,0,0,.26))]" />

        {(stage === "compositing" || ready || uploading) &&
          DETECTED_BOXES.map((box) => <DetectedRegion key={box.label} box={box} />)}

        {processing && (
          <div
            className="absolute bottom-3 left-3 flex items-center gap-2 rounded-pill px-3 py-1.5 text-[12px] font-semibold text-white"
            style={{ background: "rgba(8,6,8,.62)", backdropFilter: "blur(8px)" }}
          >
            <span
              className="size-3 rounded-full border-2 border-white/35 border-t-white"
              style={{ animation: "vspin .7s linear infinite" }}
            />
            {stage === "detecting" ? "Detecting..." : "Applying blur..."}
          </div>
        )}
      </section>

      <section className="border-hairline-strong bg-surface-2 mt-4 rounded-[18px] border px-4 py-4">
        {STAGES.map((item, index) => (
          <StepperRow
            key={item.key}
            label={item.label}
            state={stepState(stage, item.key)}
            last={index === STAGES.length - 1}
          />
        ))}
      </section>

      {error && (
        <p className="text-danger mt-3 rounded-md bg-danger/10 px-3 py-2 text-[13px]">
          {error}
        </p>
      )}

      <div className="mt-4 grid grid-cols-[1fr_auto] gap-2.5">
        <Button
          type="button"
          onClick={onApprove}
          loading={uploading}
          disabled={!ready}
          className="h-[52px] text-[15px]"
        >
          <ShieldCheck size={18} /> Approve & publish
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onRerun}
          disabled={uploading}
          className="h-[52px] px-4"
          aria-label="Re-run detection"
        >
          <RotateCcw size={18} />
        </Button>
      </div>

      <div className="text-muted/70 mt-3 flex items-center justify-center gap-2 text-[12px] font-semibold">
        <Lock size={14} /> Nothing is public until you approve
      </div>
    </div>
  );
}

function stepState(stage: ReviewStage, key: Exclude<ReviewStage, "uploading">) {
  const order: Exclude<ReviewStage, "uploading">[] = [
    "detecting",
    "compositing",
    "ready",
  ];
  if (stage === "uploading") return "done";
  const current = order.indexOf(stage);
  const target = order.indexOf(key);
  if (target < current) return "done";
  if (target === current) return "active";
  return "pending";
}

function StepperRow({
  label,
  state,
  last = false,
}: {
  label: string;
  state: "done" | "active" | "pending";
  last?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <span
          className="flex size-7 items-center justify-center rounded-full"
          style={{
            background:
              state === "done"
                ? "var(--primary)"
                : state === "active"
                  ? "var(--primary-tint)"
                  : "var(--surface-3)",
            border:
              state === "active"
                ? "1px solid var(--primary)"
                : "1px solid var(--hairline)",
            color:
              state === "done"
                ? "var(--primary-fg)"
                : state === "active"
                  ? "var(--primary)"
                  : "var(--faint)",
          }}
        >
          {state === "done" ? (
            <Check size={16} strokeWidth={3} />
          ) : state === "active" ? (
            <span
              className="size-3 rounded-full border-2 border-current/30 border-t-current"
              style={{ animation: "vspin .7s linear infinite" }}
            />
          ) : (
            <span className="size-2 rounded-full bg-current" />
          )}
        </span>
        {!last && (
          <span
            className="my-1 h-[18px] w-px"
            style={{ background: state === "done" ? "var(--primary)" : "var(--hairline)" }}
          />
        )}
      </div>
      <div
        className={`pt-1 text-[14.5px] leading-tight ${
          state === "pending"
            ? "text-faint"
            : state === "active"
              ? "text-text font-semibold"
              : "text-muted font-semibold"
        }`}
      >
        {label}
      </div>
    </div>
  );
}

function DetectedRegion({ box }: { box: DetectedBox }) {
  return (
    <div
      className="absolute rounded-[5px]"
      style={{
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        border: "2px solid var(--primary)",
        boxShadow: "0 0 0 1px rgba(0,0,0,.55), 0 0 18px rgba(194,20,59,.35)",
      }}
    >
      <span className="bg-primary text-primary-fg tabular absolute -top-5 -left-0.5 rounded-[5px] px-2 py-0.5 text-[10px] leading-tight font-bold whitespace-nowrap">
        {box.label} {box.confidence}%
      </span>
    </div>
  );
}

function MediaPreview({
  isVideo,
  src,
  className = "absolute inset-0 size-full object-cover",
  style,
}: {
  isVideo: boolean;
  src: string;
  className?: string;
  style?: CSSProperties;
}) {
  if (isVideo) {
    return (
      <video
        src={src}
        className={className}
        style={style}
        muted
        playsInline
        autoPlay
        loop
      />
    );
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="Selected media preview" className={className} style={style} />;
}
