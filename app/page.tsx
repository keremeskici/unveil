import Link from "next/link";
import { Database, Sparkles } from "lucide-react";
import {
  getFeed,
  getFullPostUnlockOwnership,
  getPostRegionsWithUnlocks,
} from "@/lib/db/queries";
import { getFeedSocial, getFollowedCreatorIds } from "@/lib/db/social";
import {
  getCurrentAppUser,
  isCurrentAppUserAuthenticated,
} from "@/lib/app-user";
import { presignPrivateGet } from "@/lib/blob";
import { PostCard, type FeedPost } from "@/components/PostCard";
import { TopBar } from "@/components/TopBar";
import { ConnectButton } from "@/components/ConnectButton";
import { BottomNav } from "@/components/BottomNav";
import { EmptyState } from "@/components/EmptyState";
import { Onboarding } from "@/components/Onboarding";

// Feed depends on live DB + per-request account state, so render dynamically.
export const dynamic = "force-dynamic";

async function loadFeed(): Promise<FeedPost[] | null> {
  try {
    const [rows, fan] = await Promise.all([getFeed(20, 0), getCurrentAppUser()]);
    const postIds = rows.map((p) => p.id);
    const creatorIds = rows.map((p) => p.creatorId);
    const [social, followed, ownedRows] = await Promise.all([
      getFeedSocial(postIds, fan?.id),
      getFollowedCreatorIds(fan?.id, creatorIds),
      fan?.id ? getFullPostUnlockOwnership(fan.id, postIds) : Promise.resolve([]),
    ]);
    const owned = new Map(ownedRows.map((r) => [r.postId, r.privateMediaKey]));
    return await Promise.all(
      rows.map(async (p) => {
        const ownedMediaKey = owned.get(p.id);
        const post: FeedPost = {
          id: p.id,
          title: p.title,
          // Preview blob is private; presign with a long TTL for the feed.
          blurredPreviewUrl: await presignPrivateGet(p.blurredPreviewUrl, 3600),
          poster: p.posterKey ? await presignPrivateGet(p.posterKey, 3600) : null,
          unlockPrice: p.unlockPrice,
          mediaType: p.mediaType,
          accessMode: p.accessMode,
          unlocked: !!ownedMediaKey,
          revealedUrl: ownedMediaKey ? await presignPrivateGet(ownedMediaKey, 300) : null,
          createdAt: p.createdAt?.toISOString(),
          social: social.get(p.id),
          creator: {
            id: p.creatorId,
            username: p.creator?.username ?? null,
            avatar: p.creator?.avatar ?? null,
            wallet: p.creator?.walletAddress ?? null,
            following: followed.has(p.creatorId),
          },
        };

        // Partial posts carry their regions; presign the crops the fan owns.
        if (p.accessMode === "partial") {
          const regions = await getPostRegionsWithUnlocks(p.id, fan?.id);
          post.regions = await Promise.all(
            regions.map(async (r) => ({
              id: r.id,
              rect: r.rect,
              unlocked: r.unlocked,
              patchUrl: r.patchMediaKey
                ? await presignPrivateGet(r.patchMediaKey, 3600)
                : null,
            })),
          );
        }

        return post;
      }),
    );
  } catch {
    // DB not provisioned yet — show the empty state instead of crashing.
    return null;
  }
}

export default async function FeedPage() {
  const isAuthenticated = await isCurrentAppUserAuthenticated();
  if (!isAuthenticated) return <Onboarding />;

  const posts = await loadFeed();

  return (
    <main className="flex min-h-dvh flex-1 flex-col">
      <TopBar>
        <ConnectButton />
      </TopBar>

      <div className="feed-scroll mx-auto w-full max-w-md flex-1 overflow-y-auto px-3.5 pt-3.5 pb-28">
        {/* Composer */}
        <Link
          href="/new"
          className="bg-surface-2 mb-4 flex items-center gap-3 rounded-card px-4 py-3.5"
        >
          <span
            className="size-[34px] shrink-0 rounded-full"
            style={{ background: "conic-gradient(from 120deg,#3a3640,#1c1a22)" }}
          />
          <span className="text-faint text-[15px]">Share something private…</span>
        </Link>

        {posts === null ? (
          <EmptyState
            icon={Database}
            title="Database not connected"
            body="Set DATABASE_URL, Supabase storage env, then run `npm run seed`."
          />
        ) : posts.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="No posts yet"
            body="Run `npm run seed` to add demo content."
          />
        ) : (
          posts.map((post, i) => (
            <PostCard
              key={post.id}
              post={post}
              isUnlocked={post.unlocked}
              initialSignedUrl={post.revealedUrl}
              priority={i === 0}
            />
          ))
        )}
      </div>

      <BottomNav />
    </main>
  );
}
