import { getFeed } from "@/lib/db/queries";
import { presignPrivateGet } from "@/lib/blob";
import { PostCard, type FeedPost } from "@/components/PostCard";
import { TopBar } from "@/components/TopBar";

// Feed depends on live DB + per-request wallet, so render dynamically.
export const dynamic = "force-dynamic";

async function loadFeed(): Promise<FeedPost[] | null> {
  try {
    const rows = await getFeed(20, 0);
    return Promise.all(
      rows.map(async (p) => ({
        id: p.id,
        title: p.title,
        // Preview blob is private; presign with a long TTL for the feed.
        blurredPreviewUrl: await presignPrivateGet(p.blurredPreviewUrl, 3600),
        unlockPrice: p.unlockPrice,
        mediaType: p.mediaType,
        creator: {
          username: p.creator?.username ?? null,
          avatar: p.creator?.avatar ?? null,
        },
      })),
    );
  } catch {
    // DB not provisioned yet — show the empty state instead of crashing.
    return null;
  }
}

export default async function FeedPage() {
  const posts = await loadFeed();

  return (
    <main className="flex min-h-screen flex-1 flex-col">
      <TopBar />

      <div className="mx-auto w-full max-w-md flex-1 px-4 pb-24 pt-4">
        {posts === null ? (
          <EmptyState
            title="Database not connected"
            body="Set DATABASE_URL and run `npm run seed` to populate the feed."
          />
        ) : posts.length === 0 ? (
          <EmptyState
            title="No posts yet"
            body="Run `npm run seed` to add demo content."
          />
        ) : (
          posts.map((post) => <PostCard key={post.id} post={post} />)
        )}
      </div>

      <nav className="pb-safe fixed bottom-0 left-0 right-0 flex justify-around border-t border-gray-800/50 bg-black/90 py-3 backdrop-blur-md">
        <NavItem icon="🏠" label="Feed" />
        <NavItem icon="⭐" label="Flex" />
        <NavItem icon="👤" label="Profile" />
      </nav>
    </main>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-24 flex flex-col items-center gap-2 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-purple-600 text-3xl font-bold">
        V
      </div>
      <p className="mt-2 font-semibold">{title}</p>
      <p className="max-w-xs text-sm text-gray-500">{body}</p>
    </div>
  );
}

function NavItem({ icon, label }: { icon: string; label: string }) {
  return (
    <button className="flex flex-col items-center gap-0.5 text-xs text-gray-400">
      <span className="text-lg">{icon}</span>
      {label}
    </button>
  );
}
