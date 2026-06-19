"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, CreditCard, Send } from "lucide-react";
import { Avatar } from "./ui/Avatar";
import { useAppAuth } from "./useAppAuth";

const PRESETS = [1, 5, 10, 20, 50, 100];

type TipStage = "idle" | "sending" | "sent" | "error";

function haptic(pattern: number | number[]) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      /* unsupported — non-fatal */
    }
  }
}

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

/**
 * Full-screen tip sheet (mirrors the prototype's "Send a tip" screen). Sends a
 * real custodial-balance tip to the post's creator via POST /api/tip.
 */
export function TipSheet({
  postId,
  creatorName,
  creatorHandle,
  creatorAvatar,
  onClose,
}: {
  postId: string;
  creatorName: string;
  creatorHandle: string;
  creatorAvatar: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const { isSignedIn } = useAppAuth();
  const [amount, setAmount] = useState(5);
  const [message, setMessage] = useState("");
  const [stage, setStage] = useState<TipStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    let live = true;
    fetch("/api/account", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (live && d?.account)
          setBalance(Number(d.account.availableBalance ?? 0));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const tooLow = balance != null && amount > balance;

  const send = useCallback(async () => {
    if (stage !== "idle") return;
    if (!isSignedIn) {
      router.push("/sign-in");
      return;
    }
    if (tooLow) return;
    setStage("sending");
    setError(null);
    haptic(8);
    try {
      const started = Date.now();
      const res = await fetch("/api/tip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId,
          amount: String(amount),
          message,
          settlementStartedAt: started,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        balance?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? "Tip failed");
      if (body.balance != null) setBalance(Number(body.balance));
      setStage("sent");
      haptic([6, 40, 12]);
      window.dispatchEvent(new Event("veil:balance-changed"));
      setTimeout(() => onClose(), 1400);
    } catch (err) {
      setStage("idle");
      setError(err instanceof Error ? err.message : "Tip failed");
    }
  }, [amount, isSignedIn, message, onClose, postId, router, stage, tooLow]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Send a tip"
      className="fixed inset-0 z-50 flex flex-col"
      style={{
        background:
          "radial-gradient(120% 55% at 50% -6%, var(--tint), transparent 58%), var(--bg)",
        animation: "vsheet .3s cubic-bezier(.22,1,.36,1) both",
      }}
    >
      <div className="mx-auto flex h-full w-full max-w-md flex-col">
        {/* Header */}
        <div
          className="border-hairline flex items-center gap-3 border-b px-4 pb-3"
          style={{ paddingTop: "max(16px, env(safe-area-inset-top, 0px))" }}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-text flex size-[34px] items-center justify-center"
          >
            <ArrowLeft size={22} />
          </button>
          <span className="text-lg font-bold tracking-tight">Send a tip</span>
        </div>

        {/* Body */}
        <div className="flex flex-1 flex-col items-center overflow-y-auto px-[22px] pt-7 pb-5">
          <Avatar name={creatorName} src={creatorAvatar} size="xl" />
          <div className="mt-3 text-lg font-bold">{creatorName}</div>
          <div className="text-faint mt-0.5 text-[13px]">{creatorHandle}</div>

          {/* Big amount + coin */}
          <div className="relative my-6 flex items-baseline gap-0.5">
            {stage === "sent" && (
              <div
                className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 text-2xl"
                style={{ animation: "vcoin 1s cubic-bezier(.22,1,.36,1) both" }}
              >
                🪙
              </div>
            )}
            <span
              className="text-primary tabular mt-1.5 self-start text-3xl font-bold"
              style={{ fontFamily: "var(--font-mono, 'Geist Mono'), monospace" }}
            >
              $
            </span>
            <span
              className="tabular text-[72px] leading-none font-bold tracking-tight"
              style={{ fontFamily: "var(--font-mono, 'Geist Mono'), monospace" }}
            >
              {amount}
            </span>
          </div>

          {/* Preset chips */}
          <div className="grid w-full max-w-[320px] grid-cols-3 gap-2.5">
            {PRESETS.map((a) => {
              const on = a === amount;
              return (
                <button
                  key={a}
                  type="button"
                  onClick={() => {
                    if (stage !== "idle") return;
                    setAmount(a);
                    haptic(4);
                  }}
                  className="tabular h-[50px] rounded-[14px] text-[17px] transition-transform active:scale-95"
                  style={
                    on
                      ? {
                          background: "var(--tint)",
                          border: "1px solid rgba(194,20,59,.4)",
                          color: "var(--text)",
                          fontWeight: 700,
                          fontFamily:
                            "var(--font-mono, 'Geist Mono'), monospace",
                        }
                      : {
                          background: "var(--surface-2)",
                          border: "1px solid var(--hairline)",
                          color: "var(--muted)",
                          fontWeight: 600,
                          fontFamily:
                            "var(--font-mono, 'Geist Mono'), monospace",
                        }
                  }
                >
                  ${a}
                </button>
              );
            })}
          </div>

          {/* Message */}
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Add a message (optional)"
            maxLength={140}
            className="bg-surface-2 border-hairline text-text mt-[18px] w-full max-w-[320px] rounded-[14px] border px-4 py-3.5 text-sm outline-none"
          />

          {/* Balance */}
          <div className="text-faint mt-4 flex items-center gap-1.5 text-[12.5px]">
            <CreditCard size={14} />
            <span>
              Wallet balance ·{" "}
              <span className="tabular text-muted">
                {balance == null ? "…" : money(balance)}
              </span>
            </span>
          </div>
          {tooLow && (
            <div className="text-primary mt-2 text-[12.5px] font-semibold">
              Not enough balance for this tip
            </div>
          )}
          {error && (
            <div className="text-danger mt-2 text-[12.5px] font-semibold">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="border-hairline border-t px-[18px] pt-3"
          style={{
            paddingBottom: "max(28px, env(safe-area-inset-bottom, 0px))",
          }}
        >
          <button
            type="button"
            onClick={send}
            disabled={stage !== "idle" || tooLow}
            className="flex h-[54px] w-full items-center justify-center gap-2.5 rounded-2xl text-base font-bold transition-transform active:scale-[0.985] disabled:cursor-not-allowed"
            style={{
              background: tooLow ? "var(--surface-3)" : "var(--primary)",
              color: tooLow ? "var(--faint)" : "#fff",
              boxShadow: tooLow ? "none" : "var(--shadow-cta)",
            }}
          >
            {stage === "sending" ? (
              <>
                <span
                  className="size-[18px] rounded-full border-2 border-white/35 border-t-white"
                  style={{ animation: "vspin .7s linear infinite" }}
                />
                <span>Sending…</span>
              </>
            ) : stage === "sent" ? (
              <>
                <Check size={20} strokeWidth={2.4} />
                <span>Sent ${amount} to {creatorHandle}</span>
              </>
            ) : (
              <>
                <Send size={19} strokeWidth={2.2} />
                <span>Send ${amount} tip</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
