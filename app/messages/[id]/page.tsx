"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ExternalLink,
  ArrowLeft,
  MoreHorizontal,
  Lock,
  Plus,
  Phone,
  Send,
  X,
} from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { useUnlock } from "@/components/useUnlock";
import { useAppAuth } from "@/components/useAppAuth";

// A conversation is per-viewer (PPV cards resolve to the viewer's unlock state),
// so this is a live client view keyed on the app auth session.

type TextMsg = { id: string; kind: "text"; me: boolean; text: string };
type PpvMsg = {
  id: string;
  kind: "ppv";
  me: boolean;
  revealed: boolean;
  title: string;
  caption: string;
  url?: string | null;
  mediaType?: "image" | "video";
  postId?: string;
  price?: string;
  priceLabel?: string;
  previewUrl?: string | null;
};
type Msg = TextMsg | PpvMsg;
type ThreadInfo = {
  id: string;
  name: string;
  avatar: string | null;
  viewerIsCreator: boolean;
};
type MyPost = {
  id: string;
  title: string;
  priceLabel: string;
  mediaType: "image" | "video";
  previewUrl: string | null;
};

export default function DmPage() {
  const { id } = useParams<{ id: string }>();
  const { isSignedIn } = useAppAuth();
  const connected = isSignedIn === true;

  const [thread, setThread] = useState<ThreadInfo | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!connected) return;
    const res = await fetch(`/api/messages/${id}`);
    if (!res.ok) {
      setLoaded(true);
      return;
    }
    const d = (await res.json()) as { thread: ThreadInfo; messages: Msg[] };
    setThread(d.thread);
    setMessages(d.messages);
    setLoaded(true);
  }, [connected, id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function sendText() {
    const body = text.trim();
    if (!body || !connected || sending) return;
    setSending(true);
    setText("");
    try {
      const res = await fetch(`/api/messages/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "text", body }),
      });
      if (res.ok) await load();
      else setText(body); // restore on failure
    } finally {
      setSending(false);
    }
  }

  async function sendPpv(postId: string) {
    if (!connected) return;
    setAttachOpen(false);
    await fetch(`/api/messages/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "ppv", postId }),
    });
    await load();
  }

  return (
    <main className="flex min-h-dvh flex-1 flex-col">
      {/* Header */}
      <header className="bg-surface/80 border-hairline pt-safe sticky top-0 z-40 border-b backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-md items-center gap-3 px-4 py-3">
          <Link
            href="/messages"
            transitionTypes={["nav-back"]}
            aria-label="Back"
            className="text-text flex size-[34px] items-center justify-center"
          >
            <ArrowLeft size={22} />
          </Link>
          <div className="relative">
            <Avatar name={thread?.name ?? "…"} src={thread?.avatar} size="md" />
            <span
              className="absolute right-0 bottom-0 size-[11px] rounded-full"
              style={{ background: "var(--success)", border: "2px solid var(--surface)" }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[15.5px] font-semibold">
                {thread?.name ?? "Conversation"}
              </span>
            </div>
            <div className="mt-px text-[12px]" style={{ color: "var(--success)" }}>
              Active now
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCallOpen(true)}
            disabled={!thread || thread.viewerIsCreator}
            className="text-muted flex size-[38px] items-center justify-center"
            aria-label={
              thread?.viewerIsCreator
                ? "Paid calls are started by fans"
                : "Start paid call"
            }
          >
            <Phone size={19} />
          </button>
          <button
            type="button"
            className="text-muted flex size-[38px] items-center justify-center"
            aria-label="More"
          >
            <MoreHorizontal size={20} />
          </button>
        </div>
      </header>

      {/* Conversation */}
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-2.5 px-3.5 py-[18px]">
        {!connected ? (
          <p className="text-faint mt-16 text-center text-sm">
            Sign in to view this conversation.
          </p>
        ) : !loaded ? (
          <p className="text-faint mt-16 text-center text-sm">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-faint mt-16 text-center text-sm">
            No messages yet. Say hello.
          </p>
        ) : (
          messages.map((m) =>
            m.kind === "text" ? (
              <div
                key={m.id}
                className="flex"
                style={{ justifyContent: m.me ? "flex-end" : "flex-start" }}
              >
                <div
                  className="max-w-[74%] rounded-[20px] px-3.5 py-2.5 text-[14.5px] leading-snug"
                  style={{
                    background: m.me ? "var(--primary)" : "var(--surface-2)",
                    color: m.me ? "#fff" : "var(--text)",
                  }}
                >
                  {m.text}
                </div>
              </div>
            ) : (
              <PpvCard key={m.id} msg={m} />
            ),
          )
        )}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <div className="bg-surface border-hairline border-t">
        <div
          className="mx-auto flex w-full max-w-md items-center gap-2.5 px-3.5 pt-3"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}
        >
          {thread?.viewerIsCreator && (
            <button
              type="button"
              onClick={() => setAttachOpen(true)}
              className="text-muted flex size-[38px] shrink-0 items-center justify-center"
              aria-label="Attach locked content"
            >
              <Lock size={22} strokeWidth={1.9} />
            </button>
          )}
          <input
            name="message"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendText()}
            placeholder="Send a message…"
            autoComplete="off"
            disabled={!connected}
            className="bg-surface-2 border-hairline text-text placeholder:text-faint h-[42px] flex-1 rounded-pill border px-4 text-[14px] outline-none"
          />
          <button
            type="button"
            onClick={sendText}
            disabled={!text.trim() || sending}
            className="bg-primary text-primary-fg flex size-[42px] shrink-0 items-center justify-center rounded-full disabled:opacity-50"
            style={{ boxShadow: "0 6px 18px var(--primary-glow)" }}
            aria-label="Send"
          >
            <Send size={20} />
          </button>
        </div>
      </div>

      {attachOpen && (
        <AttachSheet
          onPick={sendPpv}
          onClose={() => setAttachOpen(false)}
        />
      )}
      {callOpen && (
        <CallSheet
          threadId={id}
          name={thread?.name ?? "Creator"}
          avatar={thread?.avatar ?? null}
          onClose={() => setCallOpen(false)}
        />
      )}
    </main>
  );
}

/** A pay-per-view card in a DM. Recipients unlock via the normal Tempo flow;
 *  the sender (creator) just sees their sent locked card. */
function PpvCard({ msg }: { msg: PpvMsg }) {
  const [revealedUrl, setRevealedUrl] = useState<string | null>(
    msg.revealed ? (msg.url ?? null) : null,
  );
  const { state, error, unlock, connected } = useUnlock(
    msg.postId ?? "",
    msg.price ?? "0",
    { onUnlock: (url) => setRevealedUrl(url) },
  );

  const showReveal = msg.revealed || state === "unlocked";

  return (
    <div className="flex justify-start">
      <div className="bg-surface-2 border-hairline w-[230px] overflow-hidden rounded-[20px] border">
        <div className="relative" style={{ aspectRatio: "4 / 5" }}>
          {showReveal && revealedUrl ? (
            msg.mediaType === "video" ? (
              <video
                src={revealedUrl}
                className="size-full object-cover"
                controls
                playsInline
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={revealedUrl} alt={msg.title} className="size-full object-cover" />
            )
          ) : (
            <>
              {msg.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={msg.previewUrl}
                  alt=""
                  className="absolute inset-0 size-full object-cover"
                  style={{ filter: "blur(2px)", transform: "scale(1.05)" }}
                />
              ) : (
                <div
                  className="absolute inset-0"
                  style={{
                    background:
                      "radial-gradient(130% 120% at 30% 12%,#5a2738,#1f131a 56%,#0c0a0c)",
                  }}
                />
              )}
              <div
                className="absolute inset-0 flex flex-col items-center justify-center gap-3"
                style={{ background: "rgba(8,6,8,.5)" }}
              >
                <div
                  className="border-hairline-strong flex size-[46px] items-center justify-center rounded-full text-white"
                  style={{ background: "rgba(8,6,8,.55)", borderWidth: 1 }}
                >
                  <Lock size={20} />
                </div>
                {msg.me ? (
                  <span className="rounded-pill bg-black/35 px-3 py-1.5 text-[12.5px] text-white/90">
                    MPP locked · {msg.priceLabel} · sent
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={unlock}
                    disabled={state === "pending"}
                    className="bg-primary text-primary-fg flex h-[42px] items-center gap-1.5 rounded-pill px-[18px] text-[13.5px] font-semibold disabled:opacity-60"
                    style={{ boxShadow: "0 6px 20px var(--primary-glow)" }}
                  >
                    {state === "pending" ? (
                      "Unlocking…"
                    ) : (
                      <>
                        MPP unlock ·{" "}
                        <span className="tabular font-medium">{msg.priceLabel}</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
        {(msg.caption || msg.title) && (
          <div className="text-text px-3.5 py-2.5 text-[13.5px]">
            {msg.caption || msg.title}
          </div>
        )}
        {error && (
          <div className="text-danger px-3.5 pb-2.5 text-[12px]">{error}</div>
        )}
      </div>
    </div>
  );
}

function CallSheet({
  threadId,
  name,
  avatar,
  onClose,
}: {
  threadId: string;
  name: string;
  avatar: string | null;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<"idle" | "ringing" | "connected" | "settling">(
    "idle",
  );
  const [seconds, setSeconds] = useState(0);
  const [chargedSeconds, setChargedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [paymentReceipt, setPaymentReceipt] = useState<{
    hash: string;
    url: string;
  } | null>(null);
  const callIdRef = useRef<string | null>(null);
  const ringTimerRef = useRef<number | null>(null);
  const rate = 0.05;
  const secondsRef = useRef(0);
  const reserveTickRef = useRef(0);
  const reservedSecondsRef = useRef(0);
  const reserveIntervalRef = useRef<number | null>(null);
  const reservePromiseRef = useRef<Promise<boolean> | null>(null);

  function nextCallId() {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  useEffect(() => {
    if (phase !== "connected") return;
    const id = window.setInterval(() => {
      secondsRef.current += 1;
      setSeconds(secondsRef.current);
    }, 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  const clearReserveInterval = useCallback(() => {
    if (reserveIntervalRef.current) {
      window.clearInterval(reserveIntervalRef.current);
      reserveIntervalRef.current = null;
    }
  }, []);

  const reserveCallSeconds = useCallback(
    async (secondsToReserve: number) => {
      if (!callIdRef.current || secondsToReserve < 1) return true;
      if (reservePromiseRef.current) {
        const previousOk = await reservePromiseRef.current;
        if (!previousOk) return false;
      }

      const promise = (async () => {
        if (!callIdRef.current) return true;
        reserveTickRef.current += 1;
        const tick = reserveTickRef.current;

        const res = await fetch(`/api/messages/${threadId}/call`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "reserve",
            callId: callIdRef.current,
            tick,
            chargedSeconds: secondsToReserve,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
          chargedSeconds?: number;
        };

        if (res.status === 402) {
          setError(body.detail ?? "Add funds to continue this call.");
          return false;
        }
        if (!res.ok) {
          setError(body.error ?? "Could not reserve this call.");
          return false;
        }

        reservedSecondsRef.current += body.chargedSeconds ?? secondsToReserve;
        window.dispatchEvent(new Event("veil:balance-changed"));
        return true;
      })();

      reservePromiseRef.current = promise;
      try {
        return await promise;
      } finally {
        if (reservePromiseRef.current === promise) reservePromiseRef.current = null;
      }
    },
    [threadId],
  );

  const settleCall = useCallback(async () => {
    if (!callIdRef.current) return;
    const duration = secondsRef.current;
    const callId = callIdRef.current;
    clearReserveInterval();
    setPhase("settling");
    setError(null);
    if (duration < 1) {
      setPhase("idle");
      callIdRef.current = null;
      return;
    }
    try {
      if (reservePromiseRef.current) await reservePromiseRef.current;
      const remainingSeconds = duration - reservedSecondsRef.current;
      if (remainingSeconds > 0) {
        const reserved = await reserveCallSeconds(remainingSeconds);
        if (!reserved && reservedSecondsRef.current < 1) {
          setPhase("idle");
          return;
        }
      }

      const res = await fetch(`/api/messages/${threadId}/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "settle",
          callId,
          chargedSeconds: duration,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
        balance?: string;
        chargedSeconds?: number;
        paymentTxHash?: string;
        paymentTxUrl?: string | null;
      };
      if (res.status === 402) {
        setError(body.detail ?? "Add funds to complete this call.");
        setPhase("idle");
        return;
      }
      if (!res.ok) {
        setError(body.error ?? "Could not complete this call.");
        setPhase("idle");
        return;
      }
      setChargedSeconds(body.chargedSeconds ?? duration);
      setPaymentReceipt(
        body.paymentTxHash && body.paymentTxUrl
          ? { hash: body.paymentTxHash, url: body.paymentTxUrl }
          : null,
      );
      window.dispatchEvent(new Event("veil:balance-changed"));
      setPhase("idle");
    } finally {
      callIdRef.current = null;
      reserveTickRef.current = 0;
      reservedSecondsRef.current = 0;
      reservePromiseRef.current = null;
    }
  }, [clearReserveInterval, reserveCallSeconds, threadId]);

  useEffect(() => {
    if (phase !== "connected") {
      clearReserveInterval();
      return;
    }

    reserveIntervalRef.current = window.setInterval(() => {
      void reserveCallSeconds(5).then((ok) => {
        if (!ok) {
          clearReserveInterval();
          void settleCall();
        }
      });
    }, 5000);

    return clearReserveInterval;
  }, [clearReserveInterval, phase, reserveCallSeconds, settleCall]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      if (ringTimerRef.current) window.clearTimeout(ringTimerRef.current);
      clearReserveInterval();
    };
  }, [clearReserveInterval]);

  const total = `$${(chargedSeconds * rate).toFixed(2)}`;
  const estimatedTotal = `$${(seconds * rate).toFixed(2)}`;
  const isCalling = phase === "ringing" || phase === "connected";
  const statusText =
    phase === "ringing"
      ? "Ringing..."
      : phase === "connected"
        ? "Connected"
        : phase === "settling"
          ? "Ending..."
          : chargedSeconds > 0
            ? "Call ended"
            : "Ready to call";

  const startCall = () => {
    setError(null);
    setPaymentReceipt(null);
    setChargedSeconds(0);
    setSeconds(0);
    secondsRef.current = 0;
    reserveTickRef.current = 0;
    reservedSecondsRef.current = 0;
    clearReserveInterval();
    callIdRef.current = nextCallId();
    setPhase("ringing");
    if (ringTimerRef.current) window.clearTimeout(ringTimerRef.current);
    ringTimerRef.current = window.setTimeout(() => {
      ringTimerRef.current = null;
      setPhase("connected");
    }, 2400);
  };

  const stopCall = () => {
    if (phase === "ringing") {
      if (ringTimerRef.current) window.clearTimeout(ringTimerRef.current);
      ringTimerRef.current = null;
      callIdRef.current = null;
      reserveTickRef.current = 0;
      reservedSecondsRef.current = 0;
      reservePromiseRef.current = null;
      setPhase("idle");
      return;
    }
    if (phase === "connected") void settleCall();
  };

  const closeCallSheet = () => {
    if (phase === "settling") return;
    if (phase === "connected") {
      void settleCall().finally(onClose);
      return;
    }
    if (phase === "ringing") {
      if (ringTimerRef.current) window.clearTimeout(ringTimerRef.current);
      ringTimerRef.current = null;
      callIdRef.current = null;
      reserveTickRef.current = 0;
      reservedSecondsRef.current = 0;
      reservePromiseRef.current = null;
      clearReserveInterval();
    }
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Paid call"
      className="fixed inset-0 z-50 flex items-end justify-center"
    >
      <button
        type="button"
        aria-label="Close paid call"
        className="absolute inset-0 cursor-default bg-black/60"
        style={{ animation: "vscrim .2s ease both" }}
        onClick={closeCallSheet}
      />
      <section
        className="bg-surface border-hairline relative w-full max-w-md rounded-t-md border-t px-5 pt-5 text-center shadow-card"
        style={{
          animation: "vsheet .3s cubic-bezier(.22,1,.36,1) both",
          paddingBottom: "max(26px, env(safe-area-inset-bottom, 0px))",
        }}
      >
        <button
          type="button"
          onClick={closeCallSheet}
          aria-label="Close"
          className="text-muted hover:text-text absolute right-4 top-4 flex size-9 items-center justify-center"
        >
          <X size={21} />
        </button>
        <Avatar name={name} src={avatar} size="xl" verified />
        <h2 className="mt-3 text-xl font-bold">{name}</h2>
        <p className="text-faint mt-1 text-sm">{statusText}</p>
        <div className="border-hairline bg-bg mt-6 rounded-md border px-4 py-5">
          <div className="tabular text-[42px] font-bold leading-none">
            {String(Math.floor(seconds / 60)).padStart(2, "0")}:
            {String(seconds % 60).padStart(2, "0")}
          </div>
          <div className="text-muted mt-2 text-sm">
            {chargedSeconds > 0 ? (
              <>
                Total <span className="tabular text-text">{total}</span>
              </>
            ) : (
              <>
                Rate <span className="tabular text-text">$0.05/sec</span>
              </>
            )}
          </div>
          {phase === "connected" && (
            <div className="text-faint mt-1 text-xs">
              Estimated <span className="tabular">{estimatedTotal}</span>
            </div>
          )}
          {paymentReceipt && chargedSeconds > 0 && (
            <a
              href={paymentReceipt.url}
              target="_blank"
              rel="noreferrer"
              className="text-primary mt-3 inline-flex items-center justify-center gap-1.5 text-xs font-semibold"
            >
              <span>
                Receipt {paymentReceipt.hash.slice(0, 8)}...
                {paymentReceipt.hash.slice(-6)}
              </span>
              <ExternalLink size={13} aria-hidden />
            </a>
          )}
        </div>
        {error && (
          <p className="text-danger mt-4 text-sm font-semibold" role="alert">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={isCalling ? stopCall : startCall}
          disabled={phase === "settling"}
          className="mt-5 flex h-[52px] w-full items-center justify-center rounded-pill text-base font-bold"
          style={{
            background: isCalling ? "var(--surface-3)" : "var(--primary)",
            color: isCalling ? "var(--text)" : "var(--primary-fg)",
            boxShadow: isCalling ? "none" : "var(--shadow-cta)",
          }}
        >
          {phase === "settling"
            ? "Ending..."
            : isCalling
              ? phase === "ringing"
                ? "Cancel"
                : "End call"
              : "Start call"}
        </button>
      </section>
    </div>
  );
}

/** Bottom sheet: pick one of the creator's posts to send as a locked DM card. */
function AttachSheet({
  onPick,
  onClose,
}: {
  onPick: (postId: string) => void;
  onClose: () => void;
}) {
  const [posts, setPosts] = useState<MyPost[] | null>(null);

  useEffect(() => {
    fetch("/api/posts")
      .then((r) => r.json())
      .then((d) => setPosts(d.posts ?? []))
      .catch(() => setPosts([]));
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="attach-sheet-title"
      className="fixed inset-0 z-50 flex items-end justify-center"
    >
      <button
        type="button"
        aria-label="Close attachment picker"
        className="absolute inset-0 cursor-default bg-black/50"
        onClick={onClose}
      />
      <div
        className="bg-surface border-hairline relative max-h-[88dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-card border-t p-4"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)" }}
      >
        <div className="mb-3 flex items-center justify-between">
          <span id="attach-sheet-title" className="text-[15px] font-semibold">
            Send locked content
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted"
          >
            <X size={20} />
          </button>
        </div>
        {posts === null ? (
          <p className="text-faint py-8 text-center text-sm">Loading…</p>
        ) : posts.length === 0 ? (
          <p className="text-faint py-8 text-center text-sm">
            You have no posts yet to send.
          </p>
        ) : (
          <div className="grid max-h-[50vh] grid-cols-3 gap-2 overflow-y-auto">
            {posts.map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => onPick(p.id)}
                className="relative overflow-hidden rounded-md"
                style={{ aspectRatio: "4 / 5" }}
              >
                {p.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.previewUrl}
                    alt={p.title}
                    className="size-full object-cover"
                    style={{ filter: "blur(1px)" }}
                  />
                ) : (
                  <div className="bg-surface-2 size-full" />
                )}
                <span
                  className="tabular absolute bottom-1 left-1 rounded-pill px-1.5 py-0.5 text-[10px] text-white"
                  style={{ background: "rgba(8,6,8,.65)" }}
                >
                  {p.priceLabel}
                </span>
                <span className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-black/50 text-white">
                  <Plus size={14} />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
