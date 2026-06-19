"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { BottomNav } from "@/components/BottomNav";
import { ConnectButton } from "@/components/ConnectButton";
import { useAppAuth } from "@/components/useAppAuth";

type Tab = "followers" | "following";

type Connection = {
  id: string;
  username: string | null;
  displayName: string | null;
  avatar: string | null;
  walletAddress: string;
  following: boolean;
  isSelf: boolean;
};

const TABS: { key: Tab; label: string }[] = [
  { key: "followers", label: "Followers" },
  { key: "following", label: "Following" },
];

function handleFor(c: Connection) {
  return c.username ?? c.walletAddress.slice(2, 8).toLowerCase();
}

function ConnectionsView() {
  const router = useRouter();
  const params = useSearchParams();
  const { isSignedIn } = useAppAuth();
  const initialTab: Tab = params.get("tab") === "following" ? "following" : "followers";

  const [tab, setTab] = useState<Tab>(initialTab);
  const [lists, setLists] = useState<Record<Tab, Connection[] | null>>({
    followers: null,
    following: null,
  });
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const connected = isSignedIn === true;

  useEffect(() => {
    if (!connected || lists[tab] !== null) return;
    let live = true;
    fetch(`/api/profile/connections?type=${tab}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => live && setLists((p) => ({ ...p, [tab]: d.users ?? [] })))
      .catch(() => live && setLists((p) => ({ ...p, [tab]: [] })));
    return () => {
      live = false;
    };
  }, [connected, tab, lists]);

  const toggleFollow = useCallback(
    async (c: Connection) => {
      if (!connected) {
        router.push("/sign-in");
        return;
      }
      setPending((p) => ({ ...p, [c.id]: true }));
      // Optimistic flip across whichever lists hold this user.
      const flip = (rows: Connection[] | null) =>
        rows?.map((r) => (r.id === c.id ? { ...r, following: !r.following } : r)) ?? rows;
      setLists((p) => ({ followers: flip(p.followers), following: flip(p.following) }));
      try {
        const res = await fetch("/api/follow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: c.id }),
        });
        if (res.ok) {
          const d = (await res.json()) as { following: boolean };
          const set = (rows: Connection[] | null) =>
            rows?.map((r) => (r.id === c.id ? { ...r, following: d.following } : r)) ?? rows;
          setLists((p) => ({ followers: set(p.followers), following: set(p.following) }));
        }
      } finally {
        setPending((p) => ({ ...p, [c.id]: false }));
      }
    },
    [connected, router],
  );

  const rows = lists[tab];

  return (
    <main className="flex min-h-dvh flex-1 flex-col">
      {/* Header */}
      <header className="bg-surface/80 border-hairline pt-safe sticky top-0 z-40 border-b backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-md items-center gap-2.5 px-4 py-3.5">
          <Link
            href="/profile"
            aria-label="Back"
            className="text-text flex size-[34px] shrink-0 items-center justify-center"
          >
            <ArrowLeft size={22} />
          </Link>
          <h1 className="text-lg font-bold">Connections</h1>
        </div>
        {/* Tabs */}
        <div className="mx-auto flex w-full max-w-md">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-pressed={tab === t.key}
              className="flex-1 pb-2.5 pt-1 text-[14px] font-semibold transition-colors"
              style={{
                color: tab === t.key ? "var(--text)" : "var(--muted)",
                borderBottom:
                  tab === t.key ? "2px solid var(--primary)" : "2px solid transparent",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <div className="mx-auto w-full max-w-md flex-1 px-4 pb-28">
        {!connected ? (
          <div className="mt-20 flex flex-col items-center gap-5 px-8 text-center">
            <p className="text-text font-semibold">Sign in to see your connections</p>
            <ConnectButton />
          </div>
        ) : rows === null ? (
          <p className="text-faint py-10 text-center text-sm">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-faint px-8 py-12 text-center text-[13.5px]">
            {tab === "followers"
              ? "No followers yet. Share your profile to grow your audience."
              : "You're not following anyone yet."}
          </p>
        ) : (
          rows.map((c) => (
            <div
              key={c.id}
              className="border-hairline flex items-center gap-3.5 border-b py-3"
            >
              <Avatar name={handleFor(c)} src={c.avatar} size="lg" verified />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold">
                  {c.displayName || c.username || handleFor(c)}
                </p>
                <p className="text-faint mt-0.5 truncate text-[12.5px]">
                  @{handleFor(c)}
                </p>
              </div>
              {c.isSelf ? (
                <span className="text-faint shrink-0 text-[12.5px]">You</span>
              ) : (
                <button
                  type="button"
                  onClick={() => toggleFollow(c)}
                  disabled={pending[c.id]}
                  className="shrink-0 rounded-pill px-4 py-2 text-[13px] font-semibold transition-transform active:scale-95 disabled:opacity-60"
                  style={
                    c.following
                      ? {
                          background: "var(--surface-2)",
                          border: "1px solid var(--hairline)",
                          color: "var(--muted)",
                        }
                      : {
                          background: "var(--tint)",
                          border: "1px solid rgba(194,20,59,.3)",
                          color: "var(--primary)",
                        }
                  }
                >
                  {c.following ? "Following" : "Follow"}
                </button>
              )}
            </div>
          ))
        )}
      </div>

      <BottomNav />
    </main>
  );
}

export default function ConnectionsPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh" />}>
      <ConnectionsView />
    </Suspense>
  );
}
