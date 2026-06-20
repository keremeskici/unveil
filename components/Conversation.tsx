"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import {
  ArrowLeft,
  ExternalLink,
  Lock,
  Mic,
  MicOff,
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  Plus,
  Send,
  X,
} from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { useUnlock } from "@/components/useUnlock";
import { useAppAuth } from "@/components/useAppAuth";
import type {
  ConversationCallMsg,
  ConversationMsg,
  ConversationPpvMsg,
  ConversationThread,
} from "@/lib/messages-view";
import { formatDuration, optimisticId } from "@/components/conversation/utils";

type MyPost = {
  id: string;
  title: string;
  priceLabel: string;
  mediaType: "image" | "video";
  previewUrl: string | null;
};

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
                ? "Start call"
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
              ) : m.kind === "call" ? (
                <CallMessage key={m.id} msg={m} />
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
          onCallEnded={() => void refresh()}
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

/** A WhatsApp-style "Voice call" event logged after a paid call ends. Outgoing
 *  for the fan who placed it (right-aligned), incoming for the creator. */
function CallMessage({ msg }: { msg: ConversationCallMsg }) {
  const Icon = msg.me ? PhoneOutgoing : PhoneIncoming;
  return (
    <div className="flex" style={{ justifyContent: msg.me ? "flex-end" : "flex-start" }}>
      <div
        className="flex items-center gap-3 rounded-[20px] py-2.5 pl-2.5 pr-4"
        style={{ background: "var(--surface-2)", color: "var(--text)" }}
      >
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-full"
          style={{ background: "var(--surface-3)", color: "var(--success)" }}
        >
          <Icon size={18} aria-hidden />
        </span>
        <div className="leading-tight">
          <div className="text-[14.5px] font-semibold">Voice call</div>
          <div className="tabular mt-0.5 text-[12.5px]" style={{ color: "var(--muted)" }}>
            {formatDuration(msg.seconds)}
          </div>
        </div>
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

type CallPhase =
  | "idle"
  | "permission"
  | "starting"
  | "connecting"
  | "connected"
  | "settling"
  | "ended"
  | "failed";

type CallActionBody = {
  action: "start" | "connect" | "reserve" | "settle" | "release";
  callId: string;
  tick?: number;
  chargedSeconds?: number;
  elapsedSeconds?: number;
  conversationId?: string;
  elevenConversationId?: string;
  connectedAt?: string;
  endedAt?: string;
};

type ConversationTokenResponse = {
  token?: string;
  conversationToken?: string;
  conversation_token?: string;
  serverLocation?: string;
  environment?: string;
};

function CallSheet(props: {
  threadId: string;
  name: string;
  avatar: string | null;
  isBot: boolean;
  onClose: () => void;
  onCallEnded: () => void;
}) {
  return (
    <ConversationProvider>
      <CallSheetSession {...props} />
    </ConversationProvider>
  );
}

function CallSheetSession({
  threadId,
  name,
  avatar,
  isBot,
  onClose,
  onCallEnded,
}: {
  threadId: string;
  name: string;
  avatar: string | null;
  isBot: boolean;
  onClose: () => void;
  onCallEnded: () => void;
}) {
  const { startSession, endSession, isMuted, setMuted } = useConversation();
  const [phase, setPhase] = useState<CallPhase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [chargedSeconds, setChargedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [backgroundSettling, setBackgroundSettling] = useState(false);
  const [paymentReceipt, setPaymentReceipt] = useState<{
    hash: string;
    url: string;
  } | null>(null);
  const callIdRef = useRef<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const phaseRef = useRef<CallPhase>("idle");
  const rate = 0.05;
  const secondsRef = useRef(0);
  const reserveTickRef = useRef(0);
  const reservedSecondsRef = useRef(0);
  const reserveIntervalRef = useRef<number | null>(null);
  const reservePromiseRef = useRef<Promise<boolean> | null>(null);
  const settlePromiseRef = useRef<Promise<void> | null>(null);
  const mountedRef = useRef(true);
  // Latest-callback ref so settleCall (a stable useCallback) can notify the
  // parent without taking onCallEnded as a dependency.
  const onCallEndedRef = useRef(onCallEnded);
  useEffect(() => {
    onCallEndedRef.current = onCallEnded;
  }, [onCallEnded]);

  const setCallPhase = useCallback((nextPhase: CallPhase) => {
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  }, []);

  function nextCallId() {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function resetCallRefs() {
    callIdRef.current = null;
    conversationIdRef.current = null;
    reserveTickRef.current = 0;
    reservedSecondsRef.current = 0;
    reservePromiseRef.current = null;
  }

  function errorMessage(body: Record<string, unknown>, fallback: string) {
    return typeof body.detail === "string"
      ? body.detail
      : typeof body.error === "string"
        ? body.error
        : typeof body.message === "string"
          ? body.message
          : fallback;
  }

  function microphoneErrorMessage(err: unknown) {
    if (err instanceof DOMException) {
      console.error("Microphone permission failed", {
        name: err.name,
        message: err.message,
      });

      if (err.name === "NotAllowedError" || err.name === "SecurityError") {
        return `Microphone blocked by the browser or OS (${err.name}). Check Chrome site settings and macOS microphone permission for this browser.`;
      }
      if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        return "No microphone was found. Check the selected input device in browser settings.";
      }
      if (err.name === "NotReadableError" || err.name === "TrackStartError") {
        return "The microphone is allowed but cannot be opened. Close other apps using it, then retry.";
      }
      if (err.name === "OverconstrainedError") {
        return "The selected microphone does not satisfy the requested audio constraints.";
      }
      return `Microphone failed (${err.name}): ${err.message || "unknown error"}`;
    }

    if (err instanceof Error) {
      console.error("Microphone permission failed", err);
      return err.message;
    }

    console.error("Microphone permission failed", err);
    return "Could not start the microphone.";
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

  const postCallAction = useCallback(
    async (body: CallActionBody, options?: { keepalive?: boolean }) => {
      const res = await fetch(`/api/messages/${threadId}/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: options?.keepalive,
        body: JSON.stringify(body),
      });
      const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const unsupported =
        res.status === 400 &&
        (parsed.error === "Invalid call action" || parsed.error === "Invalid action");

      return {
        ok: res.ok || unsupported,
        supported: !unsupported,
        status: res.status,
        body: parsed,
      };
    },
    [threadId],
  );

  const releaseUnconnectedCall = useCallback(
    async (options?: { keepalive?: boolean }) => {
      const callId = callIdRef.current;
      if (!callId) return;
      try {
        await postCallAction(
          {
            action: "release",
            callId,
            elapsedSeconds: 0,
            endedAt: new Date().toISOString(),
          },
          options,
        );
      } catch {
        // Keep local cleanup moving even if the best-effort release is dropped.
      } finally {
        clearReserveInterval();
        resetCallRefs();
      }
    },
    [clearReserveInterval, postCallAction],
  );

  const stopElevenLabsSession = useCallback(() => {
    try {
      endSession();
    } catch {
      // Duplicate end calls are harmless; keep local cleanup moving.
    }
  }, [endSession]);

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

        const result = await postCallAction({
          action: "reserve",
          callId: callIdRef.current,
          tick,
          chargedSeconds: secondsToReserve,
          elapsedSeconds: secondsRef.current,
          conversationId: conversationIdRef.current ?? undefined,
          elevenConversationId: conversationIdRef.current ?? undefined,
        });

        if (result.status === 402) {
          setError(errorMessage(result.body, "Add funds to continue this call."));
          return false;
        }
        if (!result.ok) {
          setError(errorMessage(result.body, "Could not reserve this call."));
          return false;
        }

        const reservedSeconds =
          typeof result.body.chargedSeconds === "number"
            ? result.body.chargedSeconds
            : secondsToReserve;
        reservedSecondsRef.current += reservedSeconds;
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
    [postCallAction],
  );

  const settleCall = useCallback(
    async (options?: { keepalive?: boolean; background?: boolean }) => {
      if (settlePromiseRef.current) return settlePromiseRef.current;
      if (!callIdRef.current) return;

      const promise = (async () => {
        const duration = secondsRef.current;
        const callId = callIdRef.current;
        const isBackground = options?.background === true;
        clearReserveInterval();
        if (mountedRef.current) {
          setBackgroundSettling(isBackground);
          if (!isBackground) setCallPhase("settling");
          setError(null);
        }
        if (!callId) return;
        if (duration < 1) {
          await releaseUnconnectedCall(options);
          if (mountedRef.current) setCallPhase("ended");
          return;
        }

        try {
          if (reservePromiseRef.current) await reservePromiseRef.current;
          const remainingSeconds = duration - reservedSecondsRef.current;
          if (remainingSeconds > 0) {
            const reserved = await reserveCallSeconds(remainingSeconds);
            if (!reserved && reservedSecondsRef.current < 1) {
              if (mountedRef.current) setCallPhase("failed");
              return;
            }
          }

          const result = await postCallAction(
            {
              action: "settle",
              callId,
              chargedSeconds: duration,
              elapsedSeconds: duration,
              conversationId: conversationIdRef.current ?? undefined,
              elevenConversationId: conversationIdRef.current ?? undefined,
              endedAt: new Date().toISOString(),
            },
            options,
          );
          if (result.status === 402) {
            if (mountedRef.current) {
              setError(errorMessage(result.body, "Add funds to complete this call."));
              if (!isBackground) setCallPhase("failed");
            }
            return;
          }
          if (!result.ok) {
            if (mountedRef.current) {
              setError(errorMessage(result.body, "Could not complete this call."));
              if (!isBackground) setCallPhase("failed");
            }
            return;
          }

          const settledSeconds =
            typeof result.body.chargedSeconds === "number"
              ? result.body.chargedSeconds
              : duration;
          const paymentTxHash =
            typeof result.body.paymentTxHash === "string"
              ? result.body.paymentTxHash
              : null;
          const paymentTxUrl =
            typeof result.body.paymentTxUrl === "string"
              ? result.body.paymentTxUrl
              : null;

          if (mountedRef.current) {
            setChargedSeconds(settledSeconds);
            setPaymentReceipt(
              paymentTxHash && paymentTxUrl
                ? { hash: paymentTxHash, url: paymentTxUrl }
                : null,
            );
            window.dispatchEvent(new Event("veil:balance-changed"));
            setCallPhase("ended");
          }
          // The server logged the "Voice call" bubble as part of this settle —
          // pull the thread so it shows up (fires even if the sheet unmounted).
          onCallEndedRef.current?.();
        } finally {
          if (mountedRef.current) setBackgroundSettling(false);
          resetCallRefs();
        }
      })();

      settlePromiseRef.current = promise;
      try {
        await promise;
      } finally {
        if (settlePromiseRef.current === promise) settlePromiseRef.current = null;
      }
    },
    [
      clearReserveInterval,
      postCallAction,
      releaseUnconnectedCall,
      reserveCallSeconds,
      setCallPhase,
    ],
  );

  const markConnected = useCallback(
    ({
      callId,
      conversationId,
      connectedAt,
    }: {
      callId: string;
      conversationId: string;
      connectedAt: string;
    }) => {
      if (callIdRef.current !== callId) return;
      conversationIdRef.current = conversationId;
      setError(null);
      setCallPhase("connected");
      void postCallAction({
        action: "connect",
        callId,
        conversationId,
        elevenConversationId: conversationId,
        connectedAt,
      }).catch(() => undefined);
    },
    [postCallAction, setCallPhase],
  );

  const failOrSettle = useCallback(
    (message: string) => {
      if (
        !callIdRef.current ||
        phaseRef.current === "settling" ||
        phaseRef.current === "ended"
      ) {
        return;
      }
      if (secondsRef.current > 0) {
        setError(message);
        void settleCall();
        return;
      }
      stopElevenLabsSession();
      void releaseUnconnectedCall().finally(() => {
        if (!mountedRef.current) return;
        setError(message);
        setCallPhase("failed");
      });
    },
    [releaseUnconnectedCall, setCallPhase, settleCall, stopElevenLabsSession],
  );

  const fetchConversationToken = useCallback(
    async (callId: string) => {
      const params = new URLSearchParams({ threadId, callId });
      const res = await fetch(`/api/elevenlabs/conversation-token?${params}`, {
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as ConversationTokenResponse &
        Record<string, unknown>;
      if (!res.ok) {
        throw new Error(errorMessage(body, "Could not start the voice session."));
      }
      const token = body.conversationToken ?? body.token ?? body.conversation_token;
      if (!token) throw new Error("Voice session token was missing.");
      return {
        token,
        serverLocation: body.serverLocation,
        environment: body.environment,
      };
    },
    [threadId],
  );

  const requestMicrophone = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone access is not available in this browser.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    if (phase !== "connected") {
      clearReserveInterval();
      return;
    }

    reserveIntervalRef.current = window.setInterval(() => {
      void reserveCallSeconds(5).then((ok) => {
        if (!ok) {
          clearReserveInterval();
          stopElevenLabsSession();
          void settleCall();
        }
      });
    }, 5000);

    return clearReserveInterval;
  }, [
    clearReserveInterval,
    phase,
    reserveCallSeconds,
    settleCall,
    stopElevenLabsSession,
  ]);

  useEffect(() => {
    mountedRef.current = true;
    const previousOverflow = document.body.style.overflow;
    const finishActiveCall = () => {
      if (!callIdRef.current) return;
      if (secondsRef.current > 0) {
        stopElevenLabsSession();
        void settleCall({ keepalive: true });
        return;
      }
      stopElevenLabsSession();
      void releaseUnconnectedCall({ keepalive: true });
    };
    const onPageHide = () => finishActiveCall();
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") finishActiveCall();
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      mountedRef.current = false;
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      finishActiveCall();
      clearReserveInterval();
    };
  }, [clearReserveInterval, releaseUnconnectedCall, settleCall, stopElevenLabsSession]);

  const total = `$${(chargedSeconds * rate).toFixed(2)}`;
  const estimatedTotal = `$${(seconds * rate).toFixed(2)}`;
  const isCalling =
    phase === "permission" ||
    phase === "starting" ||
    phase === "connecting" ||
    phase === "connected";
  const canMute = phase === "connected";
  const statusText =
    phase === "permission"
      ? "Allow microphone"
      : phase === "starting"
        ? "Preparing call..."
        : phase === "connecting"
          ? "Connecting..."
          : phase === "connected"
            ? isMuted
              ? "Connected · muted"
              : "Connected"
            : phase === "settling"
              ? "Ending..."
              : phase === "failed"
                ? "Call failed"
                : chargedSeconds > 0 || phase === "ended"
                  ? "Call ended"
                  : isBot
                    ? "Ready for AI call"
                    : "Ready to call";

  const startCall = async () => {
    if (isCalling || phase === "settling") return;
    setError(null);
    setPaymentReceipt(null);
    setChargedSeconds(0);
    setBackgroundSettling(false);
    setSeconds(0);
    secondsRef.current = 0;
    reserveTickRef.current = 0;
    reservedSecondsRef.current = 0;
    clearReserveInterval();
    const callId = nextCallId();
    callIdRef.current = callId;
    setCallPhase("permission");

    try {
      await requestMicrophone();
      setCallPhase("starting");
      const token = await fetchConversationToken(callId);
      const startResult = await postCallAction({ action: "start", callId });
      if (!startResult.ok) {
        if (startResult.status === 402) {
          throw new Error(errorMessage(startResult.body, "Add funds to start this call."));
        }
        if (startResult.supported) {
          throw new Error(errorMessage(startResult.body, "Could not reserve this call."));
        }
      }

      setCallPhase("connecting");
      startSession({
        conversationToken: token.token,
        connectionType: "webrtc",
        serverLocation: token.serverLocation,
        environment: token.environment,
        onConnect: ({ conversationId }) => {
          markConnected({
            callId,
            conversationId,
            connectedAt: new Date().toISOString(),
          });
        },
        onDisconnect: () => {
          if (
            callIdRef.current !== callId ||
            phaseRef.current === "settling" ||
            phaseRef.current === "ended"
          ) {
            return;
          }
          if (secondsRef.current > 0) {
            void settleCall();
          } else {
            void releaseUnconnectedCall().finally(() => {
              if (mountedRef.current) setCallPhase("ended");
            });
          }
        },
        onError: (message) => {
          failOrSettle(message || "Voice session failed.");
        },
      });
    } catch (err) {
      stopElevenLabsSession();
      await releaseUnconnectedCall();
      setError(microphoneErrorMessage(err));
      setCallPhase("failed");
    }
  };

  const stopCall = () => {
    if (
      phase === "permission" ||
      phase === "starting" ||
      phase === "connecting"
    ) {
      stopElevenLabsSession();
      setCallPhase("ended");
      void releaseUnconnectedCall().finally(() => {
        if (mountedRef.current) setCallPhase("ended");
      });
      return;
    }
    if (phase === "connected") {
      stopElevenLabsSession();
      setCallPhase("ended");
      void settleCall({ background: true });
    }
  };

  const toggleMute = () => {
    if (!canMute) return;
    try {
      setMuted(!isMuted);
    } catch {
      setError("Could not update microphone mute.");
    }
  };

  const closeCallSheet = () => {
    if (phase === "settling") return;
    if (phase === "connected") {
      stopElevenLabsSession();
      setCallPhase("ended");
      void settleCall({ background: true });
      onClose();
      return;
    }
    if (isCalling) {
      stopElevenLabsSession();
      setCallPhase("ended");
      void releaseUnconnectedCall();
      onClose();
      return;
    }
    onClose();
  };

  const primaryLabel =
    phase === "settling"
      ? "Ending..."
      : isCalling
        ? phase === "connected"
          ? "End call"
          : "Cancel"
        : phase === "failed"
          ? "Retry call"
          : phase === "ended"
            ? "Call ended"
          : "Start call";

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
            {formatDuration(seconds)}
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
        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={toggleMute}
            disabled={!canMute}
            aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
            title={isMuted ? "Unmute microphone" : "Mute microphone"}
            className="border-hairline text-text flex size-11 items-center justify-center rounded-full border disabled:opacity-40"
            style={{
              background: isMuted ? "var(--surface-3)" : "var(--surface-2)",
            }}
          >
            {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
          </button>
        </div>
        {error && (
          <p className="text-danger mt-4 text-sm font-semibold" role="alert">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={isCalling ? stopCall : startCall}
          disabled={phase === "settling" || backgroundSettling || phase === "ended"}
          className="mt-5 flex h-[52px] w-full items-center justify-center rounded-pill text-base font-bold"
          style={{
            background: isCalling ? "var(--surface-3)" : "var(--primary)",
            color: isCalling ? "var(--text)" : "var(--primary-fg)",
            boxShadow: isCalling ? "none" : "var(--shadow-cta)",
          }}
        >
          {primaryLabel}
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
