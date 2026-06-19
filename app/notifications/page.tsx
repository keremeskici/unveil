"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell, KeyRound } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { BottomNav } from "@/components/BottomNav";
import { ConnectButton } from "@/components/ConnectButton";
import { EmptyState } from "@/components/EmptyState";
import { timeAgo } from "@/lib/time";
import { useAppAuth } from "@/components/useAppAuth";
import { usePasskeyEnrollment } from "@/components/usePasskeyEnrollment";
import {
  fetchNotifications,
  notificationsQueryKey,
  type NotifType,
} from "@/lib/notifications-client";

type FilterLabel = "Unveiled" | "Following" | "Tips";

const FILTERS: { label: FilterLabel; match: (t: NotifType) => boolean }[] = [
  { label: "Unveiled", match: (t) => t === "unlock" },
  { label: "Following", match: (t) => t === "post" },
  { label: "Tips", match: (t) => t === "tip" },
];

const EMPTY_BODY: Record<FilterLabel, string> = {
  Unveiled: "When someone unveils one of your posts, you'll see it here.",
  Following: "New posts from creators you follow will show up here.",
  Tips: "Tips you receive will show up here.",
};

function NotificationsSkeleton() {
  return (
    <ul className="px-[18px]">
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i} className="border-hairline flex items-center gap-3.5 border-b py-3.5">
          <span className="bg-surface-3 size-11 rounded-full" />
          <span className="min-w-0 flex-1 space-y-2">
            <span className="bg-surface-3 block h-4 w-56 max-w-full rounded-full" />
            <span className="bg-surface-3 block h-3 w-20 rounded-full" />
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function NotificationsPage() {
  const { isSignedIn } = useAppAuth();
  const connected = isSignedIn === true;
  const passkey = usePasskeyEnrollment();
  // Local-only synthetic notification — never returned by /api/notifications.
  const showPasskeyNotif = passkey.canEnroll && !passkey.isDismissed;
  const [filter, setFilter] = useState<FilterLabel>("Unveiled");
  const notifications = useQuery({
    queryKey: notificationsQueryKey,
    queryFn: fetchNotifications,
    enabled: connected,
    staleTime: 30_000,
  });

  const active = FILTERS.find((f) => f.label === filter) ?? FILTERS[0];
  const items = notifications.data?.items ?? [];
  const visible = items.filter((n) => active.match(n.type));

  return (
    <main className="flex min-h-dvh flex-1 flex-col">
      <header className="bg-surface/80 border-hairline pt-safe sticky top-0 z-40 border-b backdrop-blur-xl">
        <div className="mx-auto w-full max-w-md px-[18px] py-3.5">
          <h1 className="text-xl font-bold">Notifications</h1>
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
                    aria-pressed={on}
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
              {showPasskeyNotif && filter === "Unveiled" && (
                <ul className="px-[18px]">
                  <PasskeyNotifRow
                    isPending={passkey.isPending}
                    error={passkey.error}
                    onAdd={passkey.enrollPasskey}
                    onLater={passkey.dismissPrompt}
                  />
                </ul>
              )}
              {notifications.isLoading ? (
                <NotificationsSkeleton />
              ) : notifications.isError ? (
                <div className="mt-10">
                  <EmptyState
                    icon={Bell}
                    title="Could not load notifications"
                    body="Check your connection and try again."
                  />
                </div>
              ) : visible.length === 0 ? (
                showPasskeyNotif && filter === "Unveiled" ? null : (
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
