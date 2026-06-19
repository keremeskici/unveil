"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { BottomNav } from "@/components/BottomNav";
import { ConnectButton } from "@/components/ConnectButton";
import { EmptyState } from "@/components/EmptyState";
import { timeAgo } from "@/lib/time";
import { useAppAuth } from "@/components/useAppAuth";

type Thread = {
  id: string;
  name: string;
  avatar: string | null;
  preview: string;
  at: string;
  unread: number;
};

export default function MessagesPage() {
  const { isSignedIn } = useAppAuth();
  const connected = isSignedIn === true;
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [filter, setFilter] = useState<"all" | "unread">("all");

  useEffect(() => {
    if (!connected) return;
    let live = true;
    setThreads(null);
    fetch("/api/messages")
      .then((r) => r.json())
      .then((d) => live && setThreads(d.threads ?? []))
      .catch(() => live && setThreads([]));
    return () => {
      live = false;
    };
  }, [connected]);

  const unreadTotal = threads?.reduce((n, t) => n + (t.unread > 0 ? 1 : 0), 0) ?? 0;
  const visible =
    filter === "unread" ? (threads ?? []).filter((t) => t.unread > 0) : threads ?? [];

  return (
    <main className="flex min-h-dvh flex-1 flex-col">
      <header className="bg-surface/80 border-hairline pt-safe sticky top-0 z-40 border-b backdrop-blur-xl">
        <div className="mx-auto w-full max-w-md px-[18px] py-3.5">
          <span className="text-xl font-bold">Messages</span>
        </div>
      </header>

      <div className="mx-auto w-full max-w-md flex-1 pb-28">
        {!connected ? (
          <div className="mt-24 flex flex-col items-center gap-5 px-8 text-center">
            <Avatar name="you" size="xl" />
            <div>
              <p className="text-text font-semibold">Sign in to see your messages</p>
              <p className="text-faint mt-1 text-sm">
                Your conversations with creators live here.
              </p>
            </div>
            <ConnectButton />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2.5 px-[18px] pt-3.5 pb-2.5">
              <button
                type="button"
                onClick={() => setFilter("all")}
                className="rounded-pill px-4 py-1.5 text-[13px] font-semibold"
                style={
                  filter === "all"
                    ? {
                        background: "var(--primary-tint)",
                        border: "1px solid rgba(194,20,59,.35)",
                        color: "var(--text)",
                      }
                    : { background: "var(--surface-2)", color: "var(--text-muted)" }
                }
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setFilter("unread")}
                className="bg-surface-2 text-muted flex items-center gap-1.5 rounded-pill px-4 py-1.5 text-[13px] font-medium"
                style={
                  filter === "unread"
                    ? { background: "var(--primary-tint)", color: "var(--text)" }
                    : undefined
                }
              >
                Unread <span className="tabular text-primary">{unreadTotal}</span>
              </button>
            </div>

            <div key={filter} className="tab-panel">
              {threads === null ? (
                <p className="text-faint mt-16 text-center text-sm">Loading…</p>
              ) : visible.length === 0 ? (
                <div className="mt-10">
                  <EmptyState
                    icon={MessageCircle}
                    title={filter === "unread" ? "All caught up" : "No messages yet"}
                    body={
                      filter === "unread"
                        ? "You've read everything."
                        : "Tap the message icon on a post to start a conversation with a creator."
                    }
                  />
                </div>
              ) : (
                <ul className="px-[18px]">
                  {visible.map((t) => (
                    <li key={t.id} className="border-hairline border-b">
                      <Link
                        href={`/messages/${t.id}`}
                        transitionTypes={["nav-forward"]}
                        className="flex items-center gap-3.5 py-3.5"
                      >
                        <Avatar name={t.name} src={t.avatar} size="lg" verified />
                        <div className="min-w-0 flex-1">
                          <p className="text-[15px] font-semibold">{t.name}</p>
                          <p className="text-muted mt-0.5 truncate text-[13.5px]">
                            {t.preview}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <span className="text-faint text-[12px]">{timeAgo(t.at)}</span>
                          {t.unread > 0 && (
                            <span className="bg-primary text-primary-fg tabular flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold">
                              {t.unread}
                            </span>
                          )}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>

      <BottomNav />
    </main>
  );
}
