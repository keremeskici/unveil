import { and, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { getDb } from "./index";
import {
  commentLikes,
  comments,
  follows,
  postLikes,
  postSaves,
  posts,
  users,
} from "./schema";

// ── Likes & saves ─────────────────────────────────────────────────────────────

export type PostSocial = {
  likeCount: number;
  commentCount: number;
  liked: boolean;
  saved: boolean;
};

async function countPostLikes(postId: string): Promise<number> {
  const [r] = await getDb()
    .select({ n: sql<number>`COUNT(*)` })
    .from(postLikes)
    .where(eq(postLikes.postId, postId));
  return Number(r?.n ?? 0);
}

/** Toggle a like for (userId, postId). Returns the new state + fresh count. */
export async function togglePostLike(userId: string, postId: string) {
  const db = getDb();
  const existing = await db
    .select({ id: postLikes.id })
    .from(postLikes)
    .where(and(eq(postLikes.postId, postId), eq(postLikes.userId, userId)))
    .limit(1);

  if (existing.length > 0) {
    await db.delete(postLikes).where(eq(postLikes.id, existing[0].id));
  } else {
    await db.insert(postLikes).values({ postId, userId }).onConflictDoNothing();
  }

  return { liked: existing.length === 0, likeCount: await countPostLikes(postId) };
}

/** Toggle a bookmark for (userId, postId). */
export async function togglePostSave(userId: string, postId: string) {
  const db = getDb();
  const existing = await db
    .select({ id: postSaves.id })
    .from(postSaves)
    .where(and(eq(postSaves.postId, postId), eq(postSaves.userId, userId)))
    .limit(1);

  if (existing.length > 0) {
    await db.delete(postSaves).where(eq(postSaves.id, existing[0].id));
    return { saved: false };
  }
  await db.insert(postSaves).values({ postId, userId }).onConflictDoNothing();
  return { saved: true };
}

/**
 * Batch social state for a set of posts (feed). Returns a map keyed by postId.
 * Counts are derived; `liked`/`saved` reflect `viewerId` when supplied.
 */
export async function getFeedSocial(
  postIds: string[],
  viewerId?: string,
): Promise<Map<string, PostSocial>> {
  const map = new Map<string, PostSocial>();
  if (postIds.length === 0) return map;

  for (const id of postIds) {
    map.set(id, { likeCount: 0, commentCount: 0, liked: false, saved: false });
  }

  const db = getDb();
  const [likeRows, commentRows, likedRows, savedRows] = await Promise.all([
    db
      .select({ postId: postLikes.postId, n: sql<number>`COUNT(*)` })
      .from(postLikes)
      .where(inArray(postLikes.postId, postIds))
      .groupBy(postLikes.postId),
    db
      .select({ postId: comments.postId, n: sql<number>`COUNT(*)` })
      .from(comments)
      .where(inArray(comments.postId, postIds))
      .groupBy(comments.postId),
    viewerId
      ? db
          .select({ postId: postLikes.postId })
          .from(postLikes)
          .where(
            and(
              eq(postLikes.userId, viewerId),
              inArray(postLikes.postId, postIds),
            ),
          )
      : Promise.resolve([] as { postId: string }[]),
    viewerId
      ? db
          .select({ postId: postSaves.postId })
          .from(postSaves)
          .where(
            and(
              eq(postSaves.userId, viewerId),
              inArray(postSaves.postId, postIds),
            ),
          )
      : Promise.resolve([] as { postId: string }[]),
  ]);

  for (const r of likeRows) {
    const e = map.get(r.postId);
    if (e) e.likeCount = Number(r.n);
  }
  for (const r of commentRows) {
    const e = map.get(r.postId);
    if (e) e.commentCount = Number(r.n);
  }
  for (const r of likedRows) {
    const e = map.get(r.postId);
    if (e) e.liked = true;
  }
  for (const r of savedRows) {
    const e = map.get(r.postId);
    if (e) e.saved = true;
  }

  return map;
}

// ── Comments ──────────────────────────────────────────────────────────────────

export type CommentReply = {
  id: string;
  who: string;
  avatar: string | null;
  text: string;
  at: string;
  likeCount: number;
  liked: boolean;
};

export type CommentNode = CommentReply & {
  pinned: boolean;
  replies: CommentReply[];
};

function authorName(username: string | null, wallet: string): string {
  return username ?? wallet.slice(2, 8).toLowerCase();
}

/**
 * All comments for a post, structured as pinned-first top-level threads each
 * with their replies. `liked` reflects `viewerId` when supplied.
 */
export async function listComments(
  postId: string,
  viewerId?: string,
): Promise<CommentNode[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: comments.id,
      parentId: comments.parentId,
      body: comments.body,
      pinned: comments.isPinned,
      createdAt: comments.createdAt,
      username: users.username,
      wallet: users.walletAddress,
      avatar: users.avatar,
    })
    .from(comments)
    .innerJoin(users, eq(comments.userId, users.id))
    .where(eq(comments.postId, postId))
    .orderBy(desc(comments.isPinned), comments.createdAt);

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const [likeCountRows, likedRows] = await Promise.all([
    db
      .select({ commentId: commentLikes.commentId, n: sql<number>`COUNT(*)` })
      .from(commentLikes)
      .where(inArray(commentLikes.commentId, ids))
      .groupBy(commentLikes.commentId),
    viewerId
      ? db
          .select({ commentId: commentLikes.commentId })
          .from(commentLikes)
          .where(
            and(
              eq(commentLikes.userId, viewerId),
              inArray(commentLikes.commentId, ids),
            ),
          )
      : Promise.resolve([] as { commentId: string }[]),
  ]);

  const countMap = new Map(likeCountRows.map((r) => [r.commentId, Number(r.n)]));
  const likedSet = new Set(likedRows.map((r) => r.commentId));

  const toReply = (r: (typeof rows)[number]): CommentReply => ({
    id: r.id,
    who: authorName(r.username, r.wallet),
    avatar: r.avatar,
    text: r.body,
    at: r.createdAt.toISOString(),
    likeCount: countMap.get(r.id) ?? 0,
    liked: likedSet.has(r.id),
  });

  const replyMap = new Map<string, CommentReply[]>();
  for (const r of rows) {
    if (r.parentId) {
      const list = replyMap.get(r.parentId) ?? [];
      list.push(toReply(r));
      replyMap.set(r.parentId, list);
    }
  }

  return rows
    .filter((r) => !r.parentId)
    .map((r) => ({
      ...toReply(r),
      pinned: r.pinned,
      replies: (replyMap.get(r.id) ?? []).sort((a, b) =>
        a.at.localeCompare(b.at),
      ),
    }));
}

/** Insert a comment (or reply when `parentId` is set) and return it shaped. */
export async function addComment(
  userId: string,
  postId: string,
  body: string,
  parentId?: string | null,
): Promise<CommentNode> {
  const db = getDb();
  const [row] = await db
    .insert(comments)
    .values({ postId, userId, body, parentId: parentId ?? null })
    .returning();

  const author = await db
    .select({
      username: users.username,
      wallet: users.walletAddress,
      avatar: users.avatar,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const a = author[0];
  return {
    id: row.id,
    who: authorName(a?.username ?? null, a?.wallet ?? "0x000000"),
    avatar: a?.avatar ?? null,
    text: row.body,
    at: row.createdAt.toISOString(),
    likeCount: 0,
    liked: false,
    pinned: row.isPinned,
    replies: [],
  };
}

/** Toggle a like on a comment. */
export async function toggleCommentLike(userId: string, commentId: string) {
  const db = getDb();
  const existing = await db
    .select({ id: commentLikes.id })
    .from(commentLikes)
    .where(
      and(eq(commentLikes.commentId, commentId), eq(commentLikes.userId, userId)),
    )
    .limit(1);

  if (existing.length > 0) {
    await db.delete(commentLikes).where(eq(commentLikes.id, existing[0].id));
  } else {
    await db
      .insert(commentLikes)
      .values({ commentId, userId })
      .onConflictDoNothing();
  }

  const [r] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(commentLikes)
    .where(eq(commentLikes.commentId, commentId));

  return { liked: existing.length === 0, likeCount: Number(r?.n ?? 0) };
}

/** The post a comment belongs to — used to derive the creator for notifications. */
export async function getCommentPostId(commentId: string) {
  const [r] = await getDb()
    .select({ postId: comments.postId })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);
  return r?.postId ?? null;
}

// ── Follows ───────────────────────────────────────────────────────────────────

export async function getFollowerCount(userId: string): Promise<number> {
  const [r] = await getDb()
    .select({ n: sql<number>`COUNT(*)` })
    .from(follows)
    .where(eq(follows.followingId, userId));
  return Number(r?.n ?? 0);
}

export async function getFollowingCount(userId: string): Promise<number> {
  const [r] = await getDb()
    .select({ n: sql<number>`COUNT(*)` })
    .from(follows)
    .where(eq(follows.followerId, userId));
  return Number(r?.n ?? 0);
}

/** Toggle follow(follower → following). Returns new state + follower count. */
export async function toggleFollow(followerId: string, followingId: string) {
  if (followerId === followingId) {
    return { following: false, followerCount: await getFollowerCount(followingId) };
  }
  const db = getDb();
  const existing = await db
    .select({ id: follows.id })
    .from(follows)
    .where(
      and(
        eq(follows.followerId, followerId),
        eq(follows.followingId, followingId),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    await db.delete(follows).where(eq(follows.id, existing[0].id));
  } else {
    await db
      .insert(follows)
      .values({ followerId, followingId })
      .onConflictDoNothing();
  }

  return {
    following: existing.length === 0,
    followerCount: await getFollowerCount(followingId),
  };
}

/** Which of `creatorIds` does `viewerId` already follow? */
async function followedSet(
  viewerId: string | undefined,
  creatorIds: string[],
): Promise<Set<string>> {
  if (!viewerId || creatorIds.length === 0) return new Set();
  const rows = await getDb()
    .select({ followingId: follows.followingId })
    .from(follows)
    .where(
      and(
        eq(follows.followerId, viewerId),
        inArray(follows.followingId, creatorIds),
      ),
    );
  return new Set(rows.map((r) => r.followingId));
}

// ── Search & discovery ──────────────────────────────────────────────────────

export type CreatorResult = {
  id: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
  fanCount: number;
  following: boolean;
};

export type PostTile = {
  id: string;
  title: string;
  blurredPreviewKey: string; // raw key — the API presigns before returning
  mediaType: "image" | "video";
  unlockPrice: string;
  locked: boolean;
};

function shapeCreators(
  rows: { id: string; username: string | null; displayName: string | null; avatar: string | null; fanCount: number }[],
  followed: Set<string>,
): CreatorResult[] {
  return rows
    .filter((r) => r.username)
    .map((r) => ({
      id: r.id,
      username: r.username as string,
      displayName: r.displayName,
      avatar: r.avatar,
      fanCount: Number(r.fanCount),
      following: followed.has(r.id),
    }));
}

/** Creators ranked by fan count — the search screen's "Top creators". */
export async function getTopCreators(
  viewerId?: string,
  limit = 6,
): Promise<CreatorResult[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatar: users.avatar,
      fanCount: sql<number>`COUNT(${follows.id})`,
    })
    .from(users)
    .leftJoin(follows, eq(follows.followingId, users.id))
    .where(viewerId ? and(eq(users.isCreator, true), ne(users.id, viewerId)) : eq(users.isCreator, true))
    .groupBy(users.id)
    .orderBy(desc(sql`COUNT(${follows.id})`), desc(users.createdAt))
    .limit(limit);

  const followed = await followedSet(viewerId, rows.map((r) => r.id));
  return shapeCreators(rows, followed);
}

/** Recent published posts for the explore grid. */
export async function getExploreTiles(limit = 9): Promise<PostTile[]> {
  const rows = await getDb()
    .select({
      id: posts.id,
      title: posts.title,
      blurredPreviewUrl: posts.blurredPreviewUrl,
      mediaType: posts.mediaType,
      unlockPrice: posts.unlockPrice,
    })
    .from(posts)
    .where(eq(posts.isPublished, true))
    .orderBy(desc(posts.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    blurredPreviewKey: r.blurredPreviewUrl,
    mediaType: r.mediaType,
    unlockPrice: r.unlockPrice,
    locked: Number(r.unlockPrice) > 0,
  }));
}

/** Full-text-ish search across creators (username/display) and posts (title). */
export async function searchEverything(query: string, viewerId?: string) {
  const q = query.trim();
  if (!q) {
    return { creators: [] as CreatorResult[], posts: [] as PostTile[] };
  }
  const like = `%${q}%`;
  const db = getDb();

  const creatorRows = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatar: users.avatar,
      fanCount: sql<number>`COUNT(${follows.id})`,
    })
    .from(users)
    .leftJoin(follows, eq(follows.followingId, users.id))
    .where(
      and(
        eq(users.isCreator, true),
        or(ilike(users.username, like), ilike(users.displayName, like)),
      ),
    )
    .groupBy(users.id)
    .orderBy(desc(sql`COUNT(${follows.id})`))
    .limit(8);

  const followed = await followedSet(viewerId, creatorRows.map((r) => r.id));

  const postRows = await db
    .select({
      id: posts.id,
      title: posts.title,
      blurredPreviewUrl: posts.blurredPreviewUrl,
      mediaType: posts.mediaType,
      unlockPrice: posts.unlockPrice,
    })
    .from(posts)
    .where(and(eq(posts.isPublished, true), ilike(posts.title, like)))
    .orderBy(desc(posts.createdAt))
    .limit(12);

  return {
    creators: shapeCreators(creatorRows, followed),
    posts: postRows.map((r) => ({
      id: r.id,
      title: r.title,
      blurredPreviewKey: r.blurredPreviewUrl,
      mediaType: r.mediaType,
      unlockPrice: r.unlockPrice,
      locked: Number(r.unlockPrice) > 0,
    })),
  };
}
