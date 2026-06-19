"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { Database, Sparkles } from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import { ConnectButton } from "@/components/ConnectButton";
import { EmptyState } from "@/components/EmptyState";
import { PostCard } from "@/components/PostCard";
import { TopBar } from "@/components/TopBar";
import { useAppAuth } from "@/components/useAppAuth";
import { feedQueryKey, fetchFeed } from "@/lib/feed-client";

const Onboarding = dynamic(() =>
  import("@/components/Onboarding").then((m) => m.Onboarding),
);

function FeedSkeleton() {
  return (
    <div className="space-y-4">
      <div className="bg-surface-2 border-hairline rounded-card flex items-center gap-3 border px-4 py-3.5">
        <span className="bg-surface-3 size-[34px] shrink-0 rounded-full" />
        <span className="bg-surface-3 h-4 w-40 rounded-full" />
      </div>
      {Array.from({ length: 2 }).map((_, i) => (
        <div
          key={i}
          className="bg-surface-2 border-hairline overflow-hidden rounded-md border"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <div className="flex items-center gap-3 px-4 pt-3 pb-2.5">
            <span className="bg-surface-3 size-11 rounded-full" />
            <div className="flex-1 space-y-2">
              <div className="bg-surface-3 h-4 w-28 rounded-full" />
              <div className="bg-surface-3 h-3 w-20 rounded-full" />
            </div>
          </div>
          <div className="bg-surface-3 aspect-[4/5]" />
        </div>
      ))}
    </div>
  );
}

export function HomeFeed() {
  const { isLoaded, isSignedIn } = useAppAuth();
  const connected = isSignedIn === true;
  const feed = useQuery({
    queryKey: feedQueryKey,
    queryFn: fetchFeed,
    enabled: connected,
  });

  if (isLoaded && !connected) return <Onboarding />;

  const posts = feed.data?.posts;

  return (
    <main className="flex min-h-dvh flex-1 flex-col">
      <h1 className="sr-only">Home feed</h1>
      <TopBar>
        <ConnectButton />
      </TopBar>

      <div className="feed-scroll mx-auto w-full max-w-md flex-1 overflow-y-auto px-3.5 pt-3.5 pb-28">
        {feed.isLoading || !connected ? (
          <FeedSkeleton />
        ) : feed.isError ? (
          <EmptyState
            icon={Database}
            title="Could not load feed"
            body="Check your connection and try again."
          />
        ) : posts === null ? (
          <EmptyState
            icon={Database}
            title="Database not connected"
            body="Set DATABASE_URL, Supabase storage env, then run `npm run seed`."
          />
        ) : posts?.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="No posts yet"
            body="Run `npm run seed` to add demo content."
          />
        ) : (
          <>
            <Link
              href="/new"
              className="bg-surface-2 border-hairline rounded-card mb-4 flex items-center gap-3 border px-4 py-3.5"
              style={{ boxShadow: "var(--shadow-card)" }}
            >
              <span
                className="size-[34px] shrink-0 rounded-full"
                style={{ background: "conic-gradient(from 120deg,#3a3640,#1c1a22)" }}
              />
              <span className="text-faint text-[15px]">Share something private...</span>
            </Link>

            {posts?.map((post, i) => (
              <PostCard
                key={post.id}
                post={post}
                isUnlocked={post.unlocked}
                initialSignedUrl={post.revealedUrl}
                priority={i === 0}
              />
            ))}
          </>
        )}
      </div>

      <BottomNav />
    </main>
  );
}
