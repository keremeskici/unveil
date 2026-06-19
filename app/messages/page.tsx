"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { BottomNav } from "@/components/BottomNav";
import { ConnectButton } from "@/components/ConnectButton";
import { EmptyState } from "@/components/EmptyState";
import { timeAgo } from "@/lib/time";
import { useAppAuth } from "@/components/useAppAuth";
import { fetchMessages, messagesQueryKey } from "@/lib/messages-client";

function MessagesSkeleton() {
  return (
    <ul className="px-[18px]">
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i} className="border-hairline flex items-center gap-3.5 border-b py-3.5">
          <span className="bg-surface-3 size-11 rounded-full" />
          <span className="min-w-0 flex-1 space-y-2">
            <span className="bg-surface-3 block h-4 w-32 rounded-full" />
            <span className="bg-surface-3 block h-3 w-48 max-w-full rounded-full" />
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function MessagesPage() {
  const { isSignedIn } = useAppAuth();
  const connected = isSignedIn === true;
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const messages = useQuery({
    queryKey: messagesQueryKey,
    queryFn: fetchMessages,
    enabled: connected,
    staleTime: 30_000,
  });

  const threads = messages.data?.threads ?? [];
  const unreadTotal = threads?.reduce((n, t) => n + (t.unread > 0 ? 1 : 0), 0) ?? 0;
  const visible =
    filter === "unread" ? threads.filter((t) => t.unread > 0) : threads;

  return (
    <main className="flex min-h-dvh flex-1 flex-col">
      <header className="bg-surface/80 border-hairline pt-safe sticky top-0 z-40 border-b backdrop-blur-xl">
        <div className="mx-auto w-full max-w-md px-[18px] py-3.5">
          <h1 className="text-xl font-bold">Messages</h1>
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
            {/* Filter chips — same treatment as the Notifications tab. */}
            <div className="border-hairline flex gap-2.5 overflow-x-auto border-b px-[18px] py-3.5">
              <button
                type="button"
                onClick={() => setFilter("all")}
                aria-pressed={filter === "all"}
                className="shrink-0 rounded-pill px-4 py-2 text-[13.5px] transition-transform active:scale-95"
                style={
                  filter === "all"
                    ? {
                        background: "var(--tint)",
                        border: "1px solid rgba(194,20,59,.35)",
                        color: "var(--text)",
                        fontWeight: 600,
                      }
                    : {
                        background: "var(--surface-2)",
                        border: "1px solid transparent",
                        color: "var(--muted)",
                      }
                }
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setFilter("unread")}
                aria-pressed={filter === "unread"}
                className="flex shrink-0 items-center gap-1.5 rounded-pill px-4 py-2 text-[13.5px] transition-transform active:scale-95"
                style={
                  filter === "unread"
                    ? {
                        background: "var(--tint)",
                        border: "1px solid rgba(194,20,59,.35)",
                        color: "var(--text)",
                        fontWeight: 600,
                      }
                    : {
                        background: "var(--surface-2)",
                        border: "1px solid transparent",
                        color: "var(--muted)",
                      }
                }
              >
                Unread
                {unreadTotal > 0 && (
                  <span className="tabular text-primary">{unreadTotal}</span>
                )}
              </button>
            </div>

            <div key={filter} className="tab-panel">
              {messages.isLoading ? (
                <MessagesSkeleton />
              ) : messages.isError ? (
                <div className="mt-10">
                  <EmptyState
                    icon={MessageCircle}
                    title="Could not load messages"
                    body="Check your connection and try again."
                  />
                </div>
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
