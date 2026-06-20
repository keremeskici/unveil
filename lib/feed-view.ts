import "server-only";

import {
  getFeed,
  getWholePostUnlockOwnership,
  getPostRegionsWithUnlocks,
} from "@/lib/db/queries";
import { getFeedSocial, getFollowedCreatorIds } from "@/lib/db/social";
import { presignPrivateGet } from "@/lib/blob";
import type { FeedPost } from "@/components/PostCard";

export async function buildFeedView(fanId: string): Promise<FeedPost[] | null> {
  try {
    const rows = await getFeed(20, 0, fanId);
    const postIds = rows.map((p) => p.id);
    const creatorIds = rows.map((p) => p.creatorId);
    const [social, followed, ownedRows] = await Promise.all([
      getFeedSocial(postIds, fanId),
      getFollowedCreatorIds(fanId, creatorIds),
      getWholePostUnlockOwnership(fanId, postIds),
    ]);
    const owned = new Map(ownedRows.map((r) => [r.postId, r.privateMediaKey]));

    return await Promise.all(
      rows.map(async (p) => {
        const ownedMediaKey = owned.get(p.id);
        // Posts the feed reveals as a single unit (full posts, or any image —
        // only partial *videos* use per-region unlocks). A free one has nothing
        // to buy, so its clean media must ship with the feed — otherwise the card
        // renders blurred with no unlock button (the overlay only exists for paid
        // posts). Paid posts still only reveal once the fan owns the unlock.
        const free = Number(p.unlockPrice) === 0;
        const wholePostReveal = p.accessMode === "full" || p.mediaType === "image";
        const revealKey =
          ownedMediaKey ??
          (free && wholePostReveal ? p.privateMediaKey : undefined);
        const post: FeedPost = {
          id: p.id,
          title: p.title,
          // Preview/poster are non-sensitive blurred teasers: presign with a
          // long TTL AND a 10-min cache window so the URL is stable enough for
          // the CDN + next/image optimizer to cache instead of re-encoding it
          // on every request.
          blurredPreviewUrl: await presignPrivateGet(p.blurredPreviewUrl, 3600, {
            cacheWindowSeconds: 600,
          }),
          poster: p.posterKey
            ? await presignPrivateGet(p.posterKey, 3600, { cacheWindowSeconds: 600 })
            : null,
          unlockPrice: p.unlockPrice,
          mediaType: p.mediaType,
          accessMode: p.accessMode,
          clientBlurPreview:
            p.accessMode === "full" &&
            Number(p.unlockPrice) > 0 &&
            p.blurredPreviewUrl === p.privateMediaKey,
          gateAfterSeconds:
            p.mediaType === "video" && p.teaserFreeMs
              ? p.teaserFreeMs / 1000
              : null,
          unlocked: !!revealKey,
          // Owned reveals are personal + short-lived; free reveals are identical
          // for every fan, so quantize the expiry for CDN reuse like the preview.
          revealedUrl: revealKey
            ? await presignPrivateGet(
                revealKey,
                ownedMediaKey ? 300 : 3600,
                ownedMediaKey ? {} : { cacheWindowSeconds: 600 },
              )
            : null,
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
          const regions = await getPostRegionsWithUnlocks(p.id, fanId);
          post.regions = await Promise.all(
            regions.map(async (r) => ({
              id: r.id,
              rect: r.rect,
              track: r.track ?? null,
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
    // DB not provisioned yet — let the UI show the setup empty state.
    return null;
  }
}
