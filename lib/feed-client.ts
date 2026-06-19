import type { FeedPost } from "@/components/PostCard";

export const feedQueryKey = ["feed"] as const;

export async function fetchFeed() {
  const res = await fetch("/api/feed", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load feed");
  return (await res.json()) as { posts: FeedPost[] | null };
}
