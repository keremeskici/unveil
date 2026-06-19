"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Lock,
  MessageSquare,
  Search as SearchIcon,
  TrendingUp,
} from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { BottomNav } from "@/components/BottomNav";
import { useAppAuth } from "@/components/useAppAuth";

const TRENDING = [
  "Velour",
  "Noir",
  "Rooftop sets",
  "Maison Rouge",
  "Free drops",
  "Trending",
];

type Creator = {
  id: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
  walletAddress: string;
  fanCount: number;
  following: boolean;
};

type Tile = {
  id: string;
  title: string;
  mediaType: "image" | "video";
  unlockPrice: string;
  locked: boolean;
  previewUrl: string | null;
};

function fanLabel(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k fans`;
  return `${n} ${n === 1 ? "fan" : "fans"}`;
}

export default function SearchPage() {
  const router = useRouter();
  const { isSignedIn } = useAppAuth();
  const [query, setQuery] = useState("");
  const [creators, setCreators] = useState<Creator[]>([]);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const reqId = useRef(0);

  useEffect(() => {
    const id = ++reqId.current;
    setLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, {
        cache: "no-store",
      })
        .then((r) => r.json())
        .then((d) => {
          if (id !== reqId.current) return;
          setCreators(d.creators ?? []);
          setTiles(d.tiles ?? []);
          setLoading(false);
        })
        .catch(() => {
          if (id !== reqId.current) return;
          setCreators([]);
          setTiles([]);
          setLoading(false);
        });
    }, query ? 250 : 0);
    return () => clearTimeout(t);
  }, [query]);

  const toggleFollow = useCallback(
    async (creator: Creator) => {
      if (!isSignedIn) {
        router.push("/sign-in");
        return;
      }
      setPending((p) => ({ ...p, [creator.id]: true }));
      // Optimistic flip.
      setCreators((prev) =>
        prev.map((c) =>
          c.id === creator.id
            ? {
                ...c,
                following: !c.following,
                fanCount: c.fanCount + (c.following ? -1 : 1),
              }
            : c,
        ),
      );
      try {
        const res = await fetch("/api/follow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: creator.id }),
        });
        if (res.ok) {
          const d = (await res.json()) as {
            following: boolean;
            followerCount: number;
          };
          setCreators((prev) =>
            prev.map((c) =>
              c.id === creator.id
                ? { ...c, following: d.following, fanCount: d.followerCount }
                : c,
            ),
          );
        }
      } finally {
        setPending((p) => ({ ...p, [creator.id]: false }));
      }
    },
    [isSignedIn, router],
  );

  const messageCreator = useCallback(
    async (creator: Creator) => {
      if (!isSignedIn) {
        router.push("/sign-in");
        return;
      }
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creatorWallet: creator.walletAddress }),
      });
      if (res.ok) {
        const { threadId } = (await res.json()) as { threadId: string };
        router.push(`/messages/${threadId}`, { transitionTypes: ["nav-forward"] });
      }
    },
    [isSignedIn, router],
  );

  const trimmed = query.trim();

  return (
    <main className="flex min-h-dvh flex-1 flex-col">
      <h1 className="sr-only">Search</h1>
      {/* Header */}
      <header className="bg-surface/80 border-hairline pt-safe sticky top-0 z-40 border-b backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-md items-center gap-2.5 px-4 py-3">
          <Link
            href="/"
            aria-label="Back"
            className="text-text flex size-[34px] shrink-0 items-center justify-center"
          >
            <ArrowLeft size={22} />
          </Link>
          <div className="bg-surface-2 border-hairline flex h-11 flex-1 items-center gap-2.5 rounded-pill border px-4 focus-within:border-[color:var(--primary)]">
            <SearchIcon size={19} className="text-faint shrink-0" />
            <input
              autoFocus
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              aria-label="Search creators, sets, and tags"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search creators, sets, tags…"
              className="text-text min-w-0 flex-1 bg-transparent text-[15px] outline-none"
            />
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-md flex-1 px-4 pt-[18px] pb-28">
        {/* Recent & trending */}
        <p className="text-faint mb-3 text-xs font-semibold tracking-wider uppercase">
          Recent &amp; trending
        </p>
        <div className="mb-6 flex flex-wrap gap-2">
          {TRENDING.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setQuery(t)}
              className="bg-surface-2 border-hairline text-muted flex items-center gap-1.5 rounded-pill border px-3.5 py-2 text-[13.5px]"
            >
              <TrendingUp size={13} />
              {t}
            </button>
          ))}
        </div>

        {/* Top creators */}
        <p className="text-faint mb-1.5 text-xs font-semibold tracking-wider uppercase">
          {trimmed ? "Creators" : "Top creators"}
        </p>
        {loading ? (
          <p className="text-faint py-6 text-center text-sm">Searching…</p>
        ) : creators.length === 0 ? (
          <p className="text-faint py-4 text-[13.5px]">
            {trimmed ? "No creators found." : "No creators yet."}
          </p>
        ) : (
          creators.map((cr) => (
            <div
              key={cr.id}
              className="border-hairline flex items-center gap-3.5 border-b py-3"
            >
              <Avatar name={cr.username} src={cr.avatar} size="lg" verified />
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold">
                  {cr.displayName || cr.username}
                </p>
                <p className="text-faint mt-0.5 text-[12.5px]">
                  @{cr.username} · {fanLabel(cr.fanCount)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => messageCreator(cr)}
                className="bg-surface-2 text-muted hover:text-text flex size-10 shrink-0 items-center justify-center rounded-full"
                aria-label={`Chat with ${cr.username}`}
              >
                <MessageSquare size={18} />
              </button>
              <button
                type="button"
                onClick={() => toggleFollow(cr)}
                disabled={pending[cr.id]}
                className="shrink-0 rounded-pill px-4 py-2 text-[13px] font-semibold transition-transform active:scale-95 disabled:opacity-60"
                style={
                  cr.following
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
                {cr.following ? "Following" : "Follow"}
              </button>
            </div>
          ))
        )}

        {/* Explore grid */}
        <p className="text-faint mt-[22px] mb-3 text-xs font-semibold tracking-wider uppercase">
          {trimmed ? "Posts" : "Explore"}
        </p>
        {tiles.length === 0 ? (
          <p className="text-faint py-4 text-[13.5px]">Nothing here yet.</p>
        ) : (
          <div className="grid grid-cols-3 gap-[3px]">
            {tiles.map((tile) => (
              <div
                key={tile.id}
                role="img"
                aria-label={tile.locked ? "Locked post" : "Post preview"}
                className="bg-surface-3 relative aspect-square overflow-hidden rounded-md"
              >
                {tile.previewUrl && (
                  <div
                    className="absolute inset-0 bg-cover bg-center"
                    style={{
                      backgroundImage: `url(${tile.previewUrl})`,
                      filter: tile.locked ? "blur(6px)" : undefined,
                      transform: tile.locked ? "scale(1.1)" : undefined,
                    }}
                  />
                )}
                {tile.locked && (
                  <div
                    className="absolute inset-0 flex items-center justify-center"
                    style={{
                      background: "rgba(8,6,8,.4)",
                      color: "rgba(245,242,243,.9)",
                    }}
                  >
                    <Lock size={17} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <BottomNav />
    </main>
  );
}
