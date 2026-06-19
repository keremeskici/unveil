"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CreditCard,
  Lock,
  Phone,
  Plus,
  Send,
  X,
} from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { useUnlock } from "@/components/useUnlock";
import { useAppAuth } from "@/components/useAppAuth";
import type {
  ConversationMsg,
  ConversationPpvMsg,
  ConversationThread,
} from "@/lib/messages-view";

type MyPost = {
  id: string;
  title: string;
  priceLabel: string;
  mediaType: "image" | "video";
  previewUrl: string | null;
};

function formatUsd(value: number) {
  if (!Number.isFinite(value)) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function formatDuration(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(
    seconds % 60,
  ).padStart(2, "0")}`;
}

function optimisticId() {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `optimistic-${random}`;
}

/**
 * The interactive conversation view. Initial thread + messages are rendered on
 * the server (app/messages/[id]/page.tsx) and handed in as props, so there's no
 * client fetch waterfall on open — we only re-fetch to refresh after a send.
 */
export function Conversation({
  threadId,
  initialThread,
  initialMessages,
}: {
  threadId: string;
  initialThread: ConversationThread;
  initialMessages: ConversationMsg[];
}) {
  const { isSignedIn } = useAppAuth();
  const connected = isSignedIn !== false;

  const [thread, setThread] = useState<ConversationThread>(initialThread);
  const [messages, setMessages] = useState<ConversationMsg[]>(initialMessages);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [botReplyError, setBotReplyError] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/messages/${threadId}`);
      if (!res.ok) return false;
      const d = (await res.json()) as {
        thread: ConversationThread;
        messages: ConversationMsg[];
      };
      setThread(d.thread);
      setMessages(d.messages);
      return true;
    } catch {
      return false;
    }
  }, [threadId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, sending]);

  async function sendText() {
    const body = text.trim();
    if (!body || !connected || sending) return;
    const localId = optimisticId();
    setSending(true);
    setBotReplyError(null);
    setText("");
    setMessages((current) => [
      ...current,
      { id: localId, kind: "text", me: true, text: body },
    ]);
    try {
      const res = await fetch(`/api/messages/${threadId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "text", body }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          botReply?: { status: string; reason?: string };
        };
        if (
          data.botReply?.status === "skipped" &&
          data.botReply.reason === "missing_api_key"
        ) {
          setBotReplyError("OpenAI key missing");
        } else if (data.botReply?.status === "failed") {
          setBotReplyError("Reply failed");
        }
        await refresh();
        return;
      }
    } catch {
      // Roll back below.
    } finally {
      setSending(false);
    }
    setMessages((current) => current.filter((m) => m.id !== localId));
    setText((current) => (current.trim() ? current : body));
  }

  async function sendPpv(postId: string) {
    if (!connected) return;
    setAttachOpen(false);
    await fetch(`/api/messages/${threadId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "ppv", postId }),
    });
    await refresh();
  }

  return (
    <main className="flex h-dvh flex-col">
      {/* Header */}
      <header className="bg-surface/80 border-hairline pt-safe sticky top-0 z-40 shrink-0 border-b backdrop-blur-xl">
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
            <Avatar name={thread.name} src={thread.avatar} size="md" />
            <span
              className="absolute right-0 bottom-0 size-[11px] rounded-full"
              style={{ background: "var(--success)", border: "2px solid var(--surface)" }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[15.5px] font-semibold">{thread.name}</span>
            </div>
            <div className="mt-px text-[12px]" style={{ color: "var(--success)" }}>
              Active now
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCallOpen(true)}
            disabled={!thread.isBot && thread.viewerIsCreator}
            className="text-muted flex size-[38px] items-center justify-center disabled:opacity-40"
            aria-label={
              thread.isBot
                ? "Start AI call"
                : thread.viewerIsCreator
                  ? "Paid calls are started by fans"
                  : "Start paid call"
            }
          >
            <Phone size={19} />
          </button>
        </div>
      </header>

      {/* Conversation */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-md flex-col gap-2.5 px-3.5 py-[18px]">
          {messages.length === 0 ? (
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
          {sending && thread.isBot && <TypingBubble />}
          {botReplyError && thread.isBot && (
            <p className="text-faint px-2 text-[12px]">{botReplyError}</p>
          )}
          <div ref={endRef} />
        </div>
      </div>

      {/* Composer */}
      <div className="bg-surface border-hairline shrink-0 border-t">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendText();
          }}
          className="mx-auto flex w-full max-w-md items-center gap-2.5 px-3.5 pt-3"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}
        >
          {thread.viewerIsCreator && (
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
            aria-label="Message"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Send a message…"
            autoComplete="off"
            enterKeyHint="send"
            disabled={!connected}
            className="bg-surface-2 border-hairline text-text placeholder:text-faint h-[42px] flex-1 rounded-pill border px-4 text-[14px] outline-none focus-visible:border-[color:var(--primary)]"
          />
          <button
            type="submit"
            disabled={!text.trim() || sending}
            className="bg-primary text-primary-fg flex size-[42px] shrink-0 items-center justify-center rounded-full disabled:opacity-50"
            style={{ boxShadow: "0 6px 18px var(--primary-glow)" }}
            aria-label="Send"
          >
            <Send size={20} />
          </button>
        </form>
      </div>

      {attachOpen && (
        <AttachSheet onPick={sendPpv} onClose={() => setAttachOpen(false)} />
      )}
      {callOpen && (
        <CallSheet
          threadId={threadId}
          name={thread.name}
          avatar={thread.avatar}
          isBot={thread.isBot}
          onClose={() => setCallOpen(false)}
        />
      )}
    </main>
  );
}

function TypingBubble() {
  return (
    <div className="flex justify-start" aria-live="polite" aria-label="Vixen is typing">
      <div className="typing-bubble">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

/** A pay-per-view card in a DM. Recipients unlock via the normal Tempo flow;
 *  the sender (creator) just sees their sent locked card. */
function PpvCard({ msg }: { msg: ConversationPpvMsg }) {
  const [revealedUrl, setRevealedUrl] = useState<string | null>(
    msg.revealed ? (msg.url ?? null) : null,
  );
  const { state, error, unlock } = useUnlock(
    msg.postId ?? "",
    msg.price ?? "0",
    { onUnlock: (url) => setRevealedUrl(url) },
  );

  const showReveal = msg.revealed || state === "unlocked";

  return (
    <div className="flex justify-start">
      <div className="bg-surface-2 border-hairline w-full max-w-[300px] overflow-hidden rounded-[20px] border">
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
                  style={{ filter: "blur(28px)", transform: "scale(1.18)" }}
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
                    className="bg-primary text-primary-fg flex h-[46px] items-center rounded-pill px-7 text-[15px] font-semibold tabular disabled:opacity-60"
                    style={{ boxShadow: "0 6px 20px var(--primary-glow)" }}
                  >
                    {state === "pending" ? "Unlocking…" : msg.priceLabel}
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
  isBot,
  onClose,
}: {
  threadId: string;
  name: string;
  avatar: string | null;
  isBot: boolean;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<
    "idle" | "ringing" | "connected" | "settling" | "ended"
  >("idle");
  const [seconds, setSeconds] = useState(0);
  const [chargedSeconds, setChargedSeconds] = useState(0);
  const [balance, setBalance] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const callIdRef = useRef<string | null>(null);
  const ringTimerRef = useRef<number | null>(null);
  const rate = isBot ? 0 : 0.05;
  const secondsRef = useRef(0);

  // Current wallet balance, shown on the sheet so the fan knows what they have
  // to spend before starting and drains live while the call is connected.
  useEffect(() => {
    if (isBot) {
      setBalance(null);
      return;
    }
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
  }, [isBot]);

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

  const settleCall = useCallback(async () => {
    if (!callIdRef.current) return;
    const duration = secondsRef.current;
    setPhase("settling");
    setError(null);
    if (duration < 1) {
      setPhase("idle");
      return;
    }
    if (isBot) {
      setChargedSeconds(duration);
      setPhase("ended");
      callIdRef.current = null;
      return;
    }
    try {
      const res = await fetch(`/api/messages/${threadId}/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callId: callIdRef.current,
          tick: 1,
          chargedSeconds: duration,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
        balance?: string;
        chargedSeconds?: number;
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
      const billedSeconds = body.chargedSeconds ?? duration;
      const newBalance =
        body.balance != null ? Number(body.balance) : null;
      setChargedSeconds(billedSeconds);
      if (newBalance != null) setBalance(newBalance);
      window.dispatchEvent(new Event("veil:balance-changed"));
      setPhase("ended");
    } finally {
      callIdRef.current = null;
    }
  }, [isBot, threadId]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      if (ringTimerRef.current) window.clearTimeout(ringTimerRef.current);
    };
  }, []);

  const total = `$${(chargedSeconds * rate).toFixed(2)}`;
  const estimatedCost = seconds * rate;
  const estimatedTotal = `$${estimatedCost.toFixed(2)}`;
  const isCalling = phase === "ringing" || phase === "connected";
  // What the fan has left to spend right now (drains live during the call).
  const remainingBalance =
    balance == null ? null : Math.max(0, balance - estimatedCost);
  // Can't afford even a single second — block the call before it starts.
  const cannotAfford = !isBot && balance != null && balance < rate;
  const statusText =
    phase === "ringing"
      ? isBot
        ? "Calling AI..."
        : "Ringing..."
      : phase === "connected"
        ? isBot
          ? "AI connected"
          : "Connected"
        : phase === "settling"
          ? "Ending..."
          : phase === "ended"
            ? "Call ended"
            : isBot
              ? "Ready for AI call"
              : "Ready to call";

  const startCall = () => {
    if (!isBot && cannotAfford) {
      setError("Add funds to start a call.");
      return;
    }
    setError(null);
    setChargedSeconds(0);
    setSeconds(0);
    secondsRef.current = 0;
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
      setPhase("idle");
      return;
    }
    if (phase === "connected") void settleCall();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isBot ? "AI call" : "Paid call"}
      className="fixed inset-0 z-50 flex items-end justify-center"
    >
      <button
        type="button"
        aria-label={isBot ? "Close AI call" : "Close paid call"}
        className="absolute inset-0 cursor-default bg-black/60"
        style={{ animation: "vscrim .2s ease both" }}
        onClick={onClose}
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
          onClick={onClose}
          aria-label="Close"
          className="text-muted hover:text-text absolute right-4 top-4 flex size-9 items-center justify-center"
        >
          <X size={21} />
        </button>
        <Avatar name={name} src={avatar} size="xl" verified />
        <h2 className="mt-3 text-xl font-bold">{name}</h2>
        <p className="text-faint mt-1 text-sm">{statusText}</p>
        {phase === "ended" ? (
          <div className="border-hairline bg-bg mt-6 rounded-md border px-5 py-4 text-left">
            <div className="flex items-center justify-between py-1.5">
              <span className="text-muted text-[13.5px]">You spent</span>
              <span className="tabular text-text text-[15px] font-semibold">
                {total}
              </span>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-muted text-[13.5px]">Duration</span>
              <span className="tabular text-text text-[14px]">
                {formatDuration(chargedSeconds)} · {isBot ? "AI call" : "$0.05/sec"}
              </span>
            </div>
            {!isBot && balance != null && (
              <div className="border-hairline mt-1.5 flex items-center justify-between border-t pt-3">
                <span className="text-faint flex items-center gap-1.5 text-[13.5px]">
                  <CreditCard size={14} />
                  New balance
                </span>
                <span className="tabular text-text text-[15px] font-semibold">
                  {formatUsd(balance)}
                </span>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="border-hairline bg-bg mt-6 rounded-md border px-4 py-5">
              <div className="tabular text-[42px] font-bold leading-none">
                {formatDuration(seconds)}
              </div>
              <div className="text-muted mt-2 text-sm">
                {phase === "connected" ? (
                  isBot ? (
                    <>Live AI call</>
                  ) : (
                    <>
                      Charging{" "}
                      <span className="tabular text-text">{estimatedTotal}</span>
                    </>
                  )
                ) : (
                  <>
                    {isBot ? "No wallet charge" : "Rate"}{" "}
                    {!isBot && <span className="tabular text-text">$0.05/sec</span>}
                  </>
                )}
              </div>
            </div>
            {!isBot && (
              <div className="text-faint mt-3 flex items-center justify-center gap-1.5 text-[12.5px]">
                <CreditCard size={14} />
                <span>
                  {phase === "connected" ? "Balance remaining" : "Wallet balance"}{" "}
                  ·{" "}
                  <span className="tabular text-muted">
                    {(phase === "connected" ? remainingBalance : balance) == null
                      ? "..."
                      : formatUsd(
                          (phase === "connected" ? remainingBalance : balance) ??
                            0,
                        )}
                  </span>
                </span>
              </div>
            )}
            {cannotAfford && phase === "idle" && (
              <p className="text-primary mt-2 text-[12.5px] font-semibold">
                Add funds to start a call.
              </p>
            )}
          </>
        )}
        {error && (
          <p className="text-danger mt-4 text-sm font-semibold" role="alert">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={
            phase === "ended"
              ? onClose
              : isCalling
                ? stopCall
                : startCall
          }
          disabled={
            phase === "settling" || (phase === "idle" && cannotAfford)
          }
          className="mt-5 flex h-[52px] w-full items-center justify-center rounded-pill text-base font-bold disabled:opacity-60"
          style={{
            background: isCalling ? "var(--surface-3)" : "var(--primary)",
            color: isCalling ? "var(--text)" : "var(--primary-fg)",
            boxShadow: isCalling ? "none" : "var(--shadow-cta)",
          }}
        >
          {phase === "settling"
            ? "Ending..."
            : phase === "ended"
              ? "Done"
              : isCalling
                ? phase === "ringing"
                  ? "Cancel"
                  : "End call"
                : isBot
                  ? "Start AI call"
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
