"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { ArrowLeft, ImagePlus, X, Check, ShieldCheck } from "lucide-react";
import { BottomNav } from "@/components/BottomNav";

type Status = "idle" | "submitting" | "done";

export default function NewPostPage() {
  const account = useAccount();
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("0.02");
  const [status, setStatus] = useState<Status>("idle");
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connected = account.status === "connected" && account.address;
  const isVideo = file?.type.startsWith("video");

  // Manage the object URL lifecycle for the local preview.
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const canPublish = !!file && !!title.trim() && status !== "submitting";

  async function publish() {
    setError(null);
    if (!connected) {
      setError("Sign in to publish");
      return;
    }
    if (!file || !title.trim()) return;

    setStatus("submitting");
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("title", title.trim());
      body.set("price", price || "0");
      body.set("wallet", account.address as string);

      const res = await fetch("/api/posts", { method: "POST", body });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        jobId?: string;
      };
      if (!res.ok) throw new Error(j.error ?? "Upload failed");
      setJobId(j.jobId ?? null);
      setStatus("done");
    } catch (err) {
      setStatus("idle");
      setError(err instanceof Error ? err.message : "Upload failed");
    }
  }

  return (
    <main className="flex min-h-screen flex-1 flex-col">
      <header className="bg-surface/80 border-hairline pt-safe sticky top-0 z-40 border-b backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-md items-center justify-between px-[18px] py-3.5">
          <div className="flex items-center gap-3.5">
            <Link
              href="/"
              className="text-text flex size-[34px] items-center justify-center"
              aria-label="Back"
            >
              <ArrowLeft size={22} />
            </Link>
            <span className="text-xl font-bold">New post</span>
          </div>
          <button
            onClick={publish}
            disabled={!canPublish}
            className="bg-primary text-primary-fg flex items-center gap-1.5 rounded-pill px-5 py-2 text-sm font-semibold transition-transform duration-[140ms] ease-[var(--ease-veil)] active:scale-[0.97] disabled:opacity-50"
            style={{ boxShadow: "0 6px 18px var(--primary-glow)" }}
          >
            {status === "submitting" ? (
              <>
                <span
                  aria-hidden
                  className="size-[15px] rounded-full border-2 border-white/35 border-t-white"
                  style={{ animation: "vspin 0.7s linear infinite" }}
                />
                Publishing…
              </>
            ) : (
              "Publish"
            )}
          </button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-md flex-1 px-[18px] pt-[18px] pb-28">
        {status === "done" ? (
          <Done jobId={jobId} onAnother={() => resetTo("idle")} router={router} />
        ) : (
          <>
            {!connected && (
              <p className="text-danger mb-3 text-center text-[13px]">
                Sign in from the feed to publish your post.
              </p>
            )}

            {/* Caption */}
            <div className="flex gap-3">
              <span
                className="size-10 shrink-0 rounded-full"
                style={{ background: "conic-gradient(from 120deg,#3a3640,#1c1a22)" }}
              />
              <textarea
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Write something worth unveiling…"
                rows={2}
                className="text-text placeholder:text-faint mt-1.5 w-full resize-none bg-transparent text-[17px] outline-none"
              />
            </div>

            {/* Media picker */}
            <input
              ref={fileInput}
              type="file"
              accept="image/*,video/*"
              hidden
              onChange={(e) => {
                setError(null);
                setFile(e.target.files?.[0] ?? null);
              }}
            />
            {previewUrl ? (
              <div
                className="relative mt-[22px] overflow-hidden rounded-md"
                style={{ aspectRatio: "4 / 5" }}
              >
                {isVideo ? (
                  <video
                    src={previewUrl}
                    className="size-full object-cover"
                    muted
                    playsInline
                    autoPlay
                    loop
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewUrl} alt="" className="size-full object-cover" />
                )}
                <button
                  onClick={() => setFile(null)}
                  className="absolute top-3 right-3 flex size-9 items-center justify-center rounded-full text-white"
                  style={{ background: "rgba(8,6,8,.6)" }}
                  aria-label="Remove media"
                >
                  <X size={18} />
                </button>
                <div
                  className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-[12px] text-white"
                  style={{ background: "rgba(8,6,8,.6)", backdropFilter: "blur(6px)" }}
                >
                  <ShieldCheck size={13} className="text-success" />
                  auto-blur on
                </div>
              </div>
            ) : (
              <button
                onClick={() => fileInput.current?.click()}
                className="border-hairline-strong text-faint mt-[22px] flex w-full flex-col items-center justify-center gap-3 rounded-md border border-dashed transition-transform active:scale-[0.99]"
                style={{ aspectRatio: "4 / 5" }}
              >
                <ImagePlus size={34} strokeWidth={1.7} />
                <span className="tabular text-[13.5px]">add media · auto-blur on</span>
              </button>
            )}

            {/* Unlock price */}
            <div className="bg-surface-2 mt-[18px] flex items-center justify-between rounded-md p-4">
              <div>
                <div className="text-[14.5px] font-semibold">Unlock price</div>
                <div className="text-faint mt-0.5 text-[12.5px]">
                  Charged once per unlock
                </div>
              </div>
              <div
                className="tabular text-text flex items-center rounded-pill px-3.5 py-2 text-[15px]"
                style={{ background: "var(--primary-tint)", border: "1px solid rgba(194,20,59,.3)" }}
              >
                <span>$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="tabular w-14 bg-transparent text-right outline-none"
                  aria-label="Unlock price in dollars"
                />
              </div>
            </div>

            <p className="text-faint mt-4 text-center text-[12px]">
              Your media stays private. We auto-blur a preview and publish it once
              you approve the blur.
            </p>

            {error && (
              <p className="text-danger mt-3 text-center text-[13px]">{error}</p>
            )}
          </>
        )}
      </div>

      <BottomNav />
    </main>
  );

  function resetTo(s: Status) {
    setFile(null);
    setTitle("");
    setPrice("0.02");
    setError(null);
    setJobId(null);
    setStatus(s);
  }
}

function Done({
  jobId,
  onAnother,
  router,
}: {
  jobId: string | null;
  onAnother: () => void;
  router: ReturnType<typeof useRouter>;
}) {
  return (
    <div className="mt-16 flex flex-col items-center gap-5 text-center">
      <div
        className="text-success flex size-16 items-center justify-center rounded-full"
        style={{ background: "rgba(52,211,153,.12)" }}
      >
        <Check size={30} strokeWidth={2.5} />
      </div>
      <div>
        <p className="text-text text-lg font-semibold">Uploaded</p>
        <p className="text-muted mt-1 max-w-xs text-sm">
          Your post is processing. Review the auto-blur preview, then approve to
          publish — nothing goes live until you do.
        </p>
      </div>
      <div className="flex w-full max-w-xs flex-col gap-2">
        {jobId && (
          <Link
            href={`/blur-review/${jobId}`}
            className="bg-primary text-primary-fg flex h-12 items-center justify-center gap-1.5 rounded-pill font-semibold transition-transform active:scale-[0.98]"
          >
            <ShieldCheck size={18} /> Review &amp; approve
          </Link>
        )}
        <button
          onClick={() => router.push("/")}
          className={`${jobId ? "bg-surface-2 text-text border-hairline border" : "bg-primary text-primary-fg"} h-12 rounded-pill font-semibold transition-transform active:scale-[0.98]`}
        >
          Back to feed
        </button>
        <button
          onClick={onAnother}
          className="text-muted h-11 rounded-pill font-semibold transition-transform active:scale-[0.98]"
        >
          Post another
        </button>
      </div>
    </div>
  );
}
