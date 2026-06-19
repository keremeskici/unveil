"use client";

import { useEffect, useState } from "react";
import { Bell, Bookmark, KeyRound } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { BottomNav } from "@/components/BottomNav";
import { ConnectButton } from "@/components/ConnectButton";
import { EmptyState } from "@/components/EmptyState";
import { timeAgo } from "@/lib/time";
import { useAppAuth } from "@/components/useAppAuth";
import { usePasskeyEnrollment } from "@/components/usePasskeyEnrollment";

type NotifType = "unlock" | "tip" | "comment" | "follow" | "post";
type FilterLabel = "Unveils" | "New" | "Bookmarks";

type Notif = {
  id: string;
  type: NotifType;
  actor: string;
  avatar: string | null;
  action: string;
  postTitle: string;
  amount: string;
  at: string;
};

type BookmarkItem = {
  id: string;
  postId: string;
  title: string;
  creator: string;
  avatar: string | null;
  at: string;
};

const FILTERS: { label: FilterLabel; match: (t: NotifType) => boolean }[] = [
  { label: "Unveils", match: (t) => t === "unlock" },
  { label: "New", match: (t) => t === "post" },
  { label: "Bookmarks", match: () => false },
];

const EMPTY_BODY: Record<FilterLabel, string> = {
  Unveils: "When someone unveils one of your posts, you'll see it here.",
  New: "New posts from creators you follow will show up here.",
  Bookmarks: "Posts you bookmark will show up here.",
};

export default function NotificationsPage() {
  const { isSignedIn } = useAppAuth();
  const connected = isSignedIn === true;
  const passkey = usePasskeyEnrollment();
  // Local-only synthetic notification — never returned by /api/notifications.
  const showPasskeyNotif = passkey.canEnroll && !passkey.isDismissed;
  const [items, setItems] = useState<Notif[] | null>(null);
  const [bookmarks, setBookmarks] = useState<BookmarkItem[] | null>(null);
  const [filter, setFilter] = useState<FilterLabel>("Unveils");

  useEffect(() => {
    if (!connected) return;
    let live = true;
    setItems(null);
    setBookmarks(null);
    fetch("/api/notifications")
      .then((r) => r.json())
      .then((d) => live && setItems(d.items ?? []))
      .catch(() => live && setItems([]));
    fetch("/api/bookmarks")
      .then((r) => r.json())
      .then((d) => live && setBookmarks(d.items ?? []))
      .catch(() => live && setBookmarks([]));
    return () => {
      live = false;
    };
  }, [connected]);

  const active = FILTERS.find((f) => f.label === filter) ?? FILTERS[0];
  const visible = items ? items.filter((n) => active.match(n.type)) : null;
  const showingBookmarks = filter === "Bookmarks";

  return (
    <main className="flex min-h-dvh flex-1 flex-col">
      <header className="bg-surface/80 border-hairline pt-safe sticky top-0 z-40 border-b backdrop-blur-xl">
        <div className="mx-auto w-full max-w-md px-[18px] py-3.5">
          <span className="text-xl font-bold">Notifications</span>
        </div>
      </header>

      <div className="mx-auto w-full max-w-md flex-1 pb-28">
        {!connected ? (
          <div className="mt-24 flex flex-col items-center gap-5 px-8 text-center">
            <Avatar name="you" size="xl" />
            <div>
              <p className="text-text font-semibold">Sign in to see activity</p>
              <p className="text-faint mt-1 text-sm">
                Unlocks and earnings on your posts show up here.
              </p>
            </div>
            <ConnectButton />
          </div>
        ) : (
          <>
            {/* Filter chips */}
            <div className="border-hairline flex gap-2.5 overflow-x-auto border-b px-[18px] py-3.5">
              {FILTERS.map((f) => {
                const on = f.label === filter;
                return (
                  <button
                    key={f.label}
                    type="button"
                    onClick={() => setFilter(f.label)}
                    className="shrink-0 rounded-pill px-4 py-2 text-[13.5px] transition-transform active:scale-95"
                    style={
                      on
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
                    {f.label}
                  </button>
                );
              })}
            </div>

            <div key={filter} className="tab-panel">
              {showPasskeyNotif && filter === "Unveils" && (
                <ul className="px-[18px]">
                  <PasskeyNotifRow
                    isPending={passkey.isPending}
                    error={passkey.error}
                    onAdd={passkey.enrollPasskey}
                    onLater={passkey.dismissPrompt}
                  />
                </ul>
              )}
              {showingBookmarks ? (
                bookmarks === null ? (
                  <p className="text-faint mt-16 text-center text-sm">Loading…</p>
                ) : bookmarks.length === 0 ? (
                  <div className="mt-10">
                    <EmptyState
                      icon={Bookmark}
                      title="No bookmarks yet"
                      body={EMPTY_BODY.Bookmarks}
                    />
                  </div>
                ) : (
                  <ul className="px-[18px]">
                    {bookmarks.map((item) => (
                      <li
                        key={item.id}
                        className="border-hairline flex items-center gap-3.5 border-b py-3.5"
                      >
                        <Avatar name={item.creator} src={item.avatar} size="lg" />
                        <div className="min-w-0 flex-1">
                          <p className="text-[14.5px] leading-snug">
                            <span className="font-semibold">Bookmarked</span>
                            <span className="text-text"> “{item.title}”</span>
                          </p>
                          <p className="text-faint mt-0.5 text-[12px]">
                            {item.creator} · {timeAgo(item.at)}
                          </p>
                        </div>
                        <Bookmark
                          size={18}
                          aria-hidden
                          style={{ color: "var(--primary)", fill: "var(--primary)" }}
                        />
                      </li>
                    ))}
                  </ul>
                )
              ) : visible === null ? (
                <p className="text-faint mt-16 text-center text-sm">Loading…</p>
              ) : visible.length === 0 ? (
                showPasskeyNotif && filter === "Unveils" ? null : (
                  <div className="mt-10">
                    <EmptyState
                      icon={Bell}
                      title="Nothing yet"
                      body={EMPTY_BODY[filter]}
                    />
                  </div>
                )
              ) : (
                <ul className="px-[18px]">
                  {visible.map((n) => (
                    <li
                      key={n.id}
                      className="border-hairline flex items-center gap-3.5 border-b py-3.5"
                    >
                      <Avatar name={n.actor} src={n.avatar} size="lg" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[14.5px] leading-snug">
                          <span className="font-semibold">{n.actor}</span>{" "}
                          <span className="text-muted">{n.action}</span>
                          {n.postTitle && (
                            <span className="text-text"> “{n.postTitle}”</span>
                          )}
                        </p>
                        <p className="text-faint mt-0.5 text-[12px]">
                          {timeAgo(n.at)}
                        </p>
                      </div>
                      {n.amount && (
                        <span
                          className="tabular text-[12.5px]"
                          style={{ color: "var(--success)" }}
                        >
                          {n.amount}
                        </span>
                      )}
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

function PasskeyNotifRow({
  isPending,
  error,
  onAdd,
  onLater,
}: {
  isPending: boolean;
  error: string | null;
  onAdd: () => void;
  onLater: () => void;
}) {
  return (
    <li className="border-hairline flex items-center gap-3.5 border-b py-3.5">
      <span className="bg-primary/15 text-primary flex size-11 shrink-0 items-center justify-center rounded-full">
        <KeyRound size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14.5px] leading-snug">
          <span className="font-semibold">Add a passkey</span>{" "}
          <span className="text-muted">to make future logins faster.</span>
        </p>
        {error && <p className="text-danger mt-0.5 text-[12px]">{error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onLater}
          disabled={isPending}
          className="text-muted hover:text-text text-[12.5px] font-semibold disabled:opacity-50"
        >
          Later
        </button>
        <button
          type="button"
          onClick={onAdd}
          disabled={isPending}
          className="bg-primary text-primary-fg rounded-pill px-3 py-1.5 text-[12.5px] font-bold disabled:opacity-60"
        >
          {isPending ? "…" : "Add"}
        </button>
      </div>
    </li>
  );
}
