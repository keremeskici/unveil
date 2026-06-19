import { randomBytes } from "node:crypto";
import { eq, and, asc, desc, inArray, ne, sql, isNull } from "drizzle-orm";
import { getDb } from "./index";
import {
  users,
  posts,
  unlocks,
  loyaltyLedger,
  userBalances,
  postRegions,
  regionUnlocks,
  tips,
  comments,
  follows,
} from "./schema";

export type ClerkUserInput = {
  clerkId: string;
  email?: string | null;
  displayName?: string | null;
  imageUrl?: string | null;
};

function internalAddress() {
  return `0x${randomBytes(20).toString("hex")}`;
}

function clerkProfile(input: ClerkUserInput): Partial<typeof users.$inferInsert> {
  const displayName = input.displayName?.trim() || null;
  const imageUrl = input.imageUrl?.trim() || null;
  return {
    clerkId: input.clerkId,
    email: input.email?.trim().toLowerCase() || null,
    displayName,
    imageUrl,
  };
}

function usernameBase(input: ClerkUserInput) {
  const source =
    input.displayName?.trim() || input.email?.split("@")[0]?.trim() || null;
  if (!source) return null;

  const base = source
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!base) return null;
  return base.length >= 3 ? base.slice(0, 20) : base.padEnd(3, "_");
}

function usernameCandidate(base: string, attempt: number) {
  if (attempt === 0) return base.slice(0, 20);
  const suffix = String(attempt + 1);
  return `${base.slice(0, 20 - suffix.length)}${suffix}`;
}

function isUniqueViolation(err: unknown) {
  return (err as { code?: string })?.code === "23505";
}

async function addGeneratedUsernameIfMissing(
  user: typeof users.$inferSelect,
  input: ClerkUserInput,
) {
  if (user.username) return user;

  const base = usernameBase(input);
  if (!base) return user;

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = usernameCandidate(base, attempt);
    try {
      const [updated] = await getDb()
        .update(users)
        .set({ username: candidate })
        .where(and(eq(users.id, user.id), isNull(users.username)))
        .returning();
      if (updated) return updated;

      const current = await getUserById(user.id);
      return current ?? user;
    } catch (err) {
      if (isUniqueViolation(err)) continue;
      throw err;
    }
  }

  return user;
}

export async function upsertUser(walletAddress: string) {
  const db = getDb();
  const addr = walletAddress.toLowerCase();
  const [user] = await db
    .insert(users)
    .values({ walletAddress: addr })
    .onConflictDoUpdate({
      target: users.walletAddress,
      set: { walletAddress: addr },
    })
    .returning();
  return user;
}

/** Upsert a user and mark them a creator (idempotent). */
export async function upsertCreator(walletAddress: string) {
  const db = getDb();
  const addr = walletAddress.toLowerCase();
  const [user] = await db
    .insert(users)
    .values({ walletAddress: addr, isCreator: true })
    .onConflictDoUpdate({
      target: users.walletAddress,
      set: { isCreator: true },
    })
    .returning();
  return user;
}

export async function getUserById(userId: string) {
  const db = getDb();
  return db.query.users.findFirst({
    where: eq(users.id, userId),
  });
}

export async function getUserByUsername(username: string) {
  const handle = username.replace(/^@/, "").trim();
  if (!handle) return null;
  const db = getDb();
  return db.query.users.findFirst({
    where: eq(users.username, handle),
  });
}

export async function getUserByClerkId(clerkId: string) {
  const db = getDb();
  return db.query.users.findFirst({
    where: eq(users.clerkId, clerkId),
  });
}

export async function ensureUserBalance(userId: string) {
  await getDb().insert(userBalances).values({ userId }).onConflictDoNothing();
}

export async function getOrCreateUserForClerk(input: ClerkUserInput) {
  const db = getDb();
  const profile = clerkProfile(input);
  const [user] = await db
    .insert(users)
    .values({
      ...profile,
      avatar: input.imageUrl?.trim() || null,
      walletAddress: internalAddress(),
    })
    .onConflictDoUpdate({
      target: users.clerkId,
      set: profile,
    })
    .returning();

  await ensureUserBalance(user.id);
  return addGeneratedUsernameIfMissing(user, input);
}

export async function attachAnonymousCustodialAccountToClerk({
  cookieUserId,
  clerkUser,
}: {
  cookieUserId?: string;
  clerkUser: ClerkUserInput;
}) {
  const profile = clerkProfile(clerkUser);
  const user = await getDb().transaction(async (tx) => {
    const existing = await tx.query.users.findFirst({
      where: eq(users.clerkId, clerkUser.clerkId),
    });
    if (existing) {
      const [updated] = await tx
        .update(users)
        .set(profile)
        .where(eq(users.id, existing.id))
        .returning();
      await tx.insert(userBalances).values({ userId: updated.id }).onConflictDoNothing();
      return updated;
    }

    if (cookieUserId) {
      const anonymous = await tx.query.users.findFirst({
        where: eq(users.id, cookieUserId),
      });
      if (anonymous && !anonymous.clerkId) {
        const [attached] = await tx
          .update(users)
          .set(profile)
          .where(eq(users.id, anonymous.id))
          .returning();
        await tx
          .insert(userBalances)
          .values({ userId: attached.id })
          .onConflictDoNothing();
        return attached;
      }
    }

    const [created] = await tx
      .insert(users)
      .values({
        ...profile,
        avatar: clerkUser.imageUrl?.trim() || null,
        walletAddress: internalAddress(),
      })
      .returning();
    await tx.insert(userBalances).values({ userId: created.id }).onConflictDoNothing();
    return created;
  });
  return addGeneratedUsernameIfMissing(user, clerkUser);
}

/** Mark an existing local user as a creator. */
export async function markUserCreator(userId: string) {
  const db = getDb();
  const [user] = await db
    .update(users)
    .set({ isCreator: true })
    .where(eq(users.id, userId))
    .returning();
  return user;
}

export async function getFeed(limit = 20, offset = 0) {
  const db = getDb();
  return db.query.posts.findMany({
    where: eq(posts.isPublished, true),
    with: { creator: true },
    orderBy: [desc(posts.createdAt)],
    limit,
    offset,
  });
}

export async function getPost(postId: string) {
  const db = getDb();
  return db.query.posts.findFirst({
    where: eq(posts.id, postId),
    with: { creator: true },
  });
}

/** A single region plus its parent post (for price + ownership checks). */
export async function getPostRegion(regionId: string) {
  const db = getDb();
  return db.query.postRegions.findFirst({
    where: eq(postRegions.id, regionId),
    with: { post: true },
  });
}

/**
 * Regions for a partial post, each annotated with whether `fanId` has unlocked
 * it. Drives the partial player: locked regions show a $ button, unlocked ones
 * overlay the clean crop. `patchMediaKey` is returned ONLY for regions this fan
 * already owns (so the caller can presign them); locked crops never leave here.
 */
export async function getPostRegionsWithUnlocks(postId: string, fanId?: string) {
  const db = getDb();
  const regions = await db.query.postRegions.findMany({
    where: eq(postRegions.postId, postId),
    orderBy: [asc(postRegions.position)],
  });
  if (regions.length === 0) return [];

  const unlockedIds = new Set<string>();
  if (fanId) {
    const rows = await db.query.regionUnlocks.findMany({
      where: and(
        eq(regionUnlocks.fanId, fanId),
        inArray(
          regionUnlocks.postRegionId,
          regions.map((r) => r.id),
        ),
      ),
    });
    rows.forEach((r) => unlockedIds.add(r.postRegionId));
  }

  return regions.map((r) => {
    const unlocked = unlockedIds.has(r.id);
    return {
      id: r.id,
      rect: r.rect,
      position: r.position,
      unlocked,
      // Only owned crops expose their key for presigning.
      patchMediaKey: unlocked ? r.patchMediaKey : null,
    };
  });
}

/** A creator's own posts, newest first — used to attach a PPV card in a DM. */
export async function getPostsByCreator(creatorId: string, limit = 30) {
  const db = getDb();
  return db.query.posts.findMany({
    where: eq(posts.creatorId, creatorId),
    orderBy: [desc(posts.createdAt)],
    limit,
  });
}

export async function getUserByWallet(walletAddress: string) {
  const db = getDb();
  return db.query.users.findFirst({
    where: eq(users.walletAddress, walletAddress.toLowerCase()),
  });
}

export async function hasUnlocked(fanId: string, postId: string) {
  const db = getDb();
  const row = await db.query.unlocks.findFirst({
    where: and(eq(unlocks.fanId, fanId), eq(unlocks.postId, postId)),
  });
  return !!row;
}

export async function getFullPostUnlockOwnership(
  fanId: string,
  postIds: string[],
) {
  const ids = Array.from(new Set(postIds.filter(Boolean)));
  if (ids.length === 0) return [];

  return getDb()
    .select({
      postId: unlocks.postId,
      privateMediaKey: posts.privateMediaKey,
    })
    .from(unlocks)
    .innerJoin(posts, eq(unlocks.postId, posts.id))
    .where(
      and(
        eq(unlocks.fanId, fanId),
        inArray(unlocks.postId, ids),
        eq(posts.accessMode, "full"),
      ),
    );
}

export async function recordUnlock(
  fanId: string,
  postId: string,
  paymentTxHash: string,
  amountPaid: string,
  settlementMs: number,
  loyaltyAmount: string,
) {
  return getDb().transaction(async (tx) => {
    const [unlock] = await tx
      .insert(unlocks)
      .values({ fanId, postId, paymentTxHash, amountPaid, settlementMs })
      .returning();
    await tx.insert(loyaltyLedger).values({
      userId: fanId,
      amount: loyaltyAmount,
      eventType: "post_unlock",
      referenceId: unlock.id,
      txHash: paymentTxHash,
    });
    return unlock;
  });
}

export async function getUserStats(userId: string) {
  const db = getDb();
  const [r] = await db
    .select({
      unlockCount: sql<number>`COUNT(*)`,
      totalPaid: sql<string>`COALESCE(SUM(${unlocks.amountPaid}), 0)`,
      avgSettleMs: sql<number>`COALESCE(ROUND(AVG(${unlocks.settlementMs})), 0)`,
    })
    .from(unlocks)
    .where(eq(unlocks.fanId, userId));
  return {
    unlockCount: Number(r?.unlockCount ?? 0),
    totalPaid: r?.totalPaid ?? "0",
    avgSettleMs: Number(r?.avgSettleMs ?? 0),
  };
}

export async function getLoyaltyBalance(userId: string): Promise<string> {
  const db = getDb();
  const [r] = await db
    .select({
      bal: sql<string>`COALESCE(SUM(${loyaltyLedger.amount}), 0)`,
    })
    .from(loyaltyLedger)
    .where(eq(loyaltyLedger.userId, userId));
  return r?.bal ?? "0";
}

/**
 * Persist editable profile fields. Only keys present in `patch` are written, so
 * a username-only edit never clobbers the avatar. `username` is uniquely
 * indexed — a collision surfaces as a Postgres unique-violation for the caller
 * to translate into a 409.
 */
export async function updateUserProfile(
  walletAddress: string,
  patch: { username?: string | null; avatar?: string | null },
) {
  const db = getDb();
  const set: Partial<typeof users.$inferInsert> = {};
  if (patch.username !== undefined) set.username = patch.username;
  if (patch.avatar !== undefined) set.avatar = patch.avatar;
  const [user] = await db
    .update(users)
    .set(set)
    .where(eq(users.walletAddress, walletAddress.toLowerCase()))
    .returning();
  return user;
}

export async function updateUserProfileById(
  userId: string,
  patch: { username?: string | null; avatar?: string | null },
) {
  const db = getDb();
  const set: Partial<typeof users.$inferInsert> = {};
  if (patch.username !== undefined) set.username = patch.username;
  if (patch.avatar !== undefined) set.avatar = patch.avatar;
  const [user] = await db
    .update(users)
    .set(set)
    .where(eq(users.id, userId))
    .returning();
  return user;
}

/**
 * The fan's collection — every post they've unlocked, newest first. Returns the
 * private media key so the caller can presign the real (unblurred) media: this
 * is the reward for having paid.
 */
export async function getUnlockedPosts(fanId: string, limit = 24) {
  const db = getDb();
  return db
    .select({
      postId: posts.id,
      title: posts.title,
      privateMediaKey: posts.privateMediaKey,
      blurredPreviewUrl: posts.blurredPreviewUrl,
      mediaType: posts.mediaType,
      unlockPrice: posts.unlockPrice,
      unlockedAt: unlocks.unlockedAt,
      creatorUsername: users.username,
    })
    .from(unlocks)
    .innerJoin(posts, eq(unlocks.postId, posts.id))
    .innerJoin(users, eq(posts.creatorId, users.id))
    .where(eq(unlocks.fanId, fanId))
    .orderBy(desc(unlocks.unlockedAt))
    .limit(limit);
}

/**
 * Notifications, derived (no dedicated table): the incoming unlock events on
 * *this user's* posts — i.e. "someone unveiled your post". Each carries the
 * actor, the post, the gross amount paid, and when. The creator-cut split is
 * applied by the caller (see /api/notifications).
 */
export type NotifType = "unlock" | "tip" | "comment" | "follow" | "post";

export type RawNotification = {
  type: NotifType;
  id: string;
  amount: string | null;
  at: Date;
  postTitle: string | null;
  actorUsername: string | null;
  actorWallet: string;
  actorAvatar: string | null;
};

/**
 * Activity on *this user's* content, derived (no dedicated table) by unioning
 * five sources, newest first:
 *  - unlocks  → "unveiled your post"  (Unveils)
 *  - tips     → "tipped you"          (Tips)
 *  - comments → "commented on your post" (Mentions)
 *  - follows  → "started following you"
 *  - posts    → "posted" from creators this user follows (New)
 * Amounts are gross; the caller applies the creator cut where relevant.
 */
export async function getNotifications(
  userId: string,
  limit = 30,
): Promise<RawNotification[]> {
  const db = getDb();

  const [unlockRows, tipRows, commentRows, followRows, postRows] =
    await Promise.all([
      db
        .select({
          id: unlocks.id,
          amount: unlocks.amountPaid,
          at: unlocks.unlockedAt,
          postTitle: posts.title,
          actorUsername: users.username,
          actorWallet: users.walletAddress,
          actorAvatar: users.avatar,
        })
        .from(unlocks)
        .innerJoin(posts, eq(unlocks.postId, posts.id))
        .innerJoin(users, eq(unlocks.fanId, users.id))
        .where(eq(posts.creatorId, userId))
        .orderBy(desc(unlocks.unlockedAt))
        .limit(limit),
      db
        .select({
          id: tips.id,
          amount: tips.amount,
          at: tips.createdAt,
          postTitle: posts.title,
          actorUsername: users.username,
          actorWallet: users.walletAddress,
          actorAvatar: users.avatar,
        })
        .from(tips)
        .leftJoin(posts, eq(tips.postId, posts.id))
        .innerJoin(users, eq(tips.fanId, users.id))
        .where(eq(tips.creatorId, userId))
        .orderBy(desc(tips.createdAt))
        .limit(limit),
      db
        .select({
          id: comments.id,
          at: comments.createdAt,
          postTitle: posts.title,
          actorUsername: users.username,
          actorWallet: users.walletAddress,
          actorAvatar: users.avatar,
        })
        .from(comments)
        .innerJoin(posts, eq(comments.postId, posts.id))
        .innerJoin(users, eq(comments.userId, users.id))
        .where(and(eq(posts.creatorId, userId), ne(comments.userId, userId)))
        .orderBy(desc(comments.createdAt))
        .limit(limit),
      db
        .select({
          id: follows.id,
          at: follows.createdAt,
          actorUsername: users.username,
          actorWallet: users.walletAddress,
          actorAvatar: users.avatar,
        })
        .from(follows)
        .innerJoin(users, eq(follows.followerId, users.id))
        .where(eq(follows.followingId, userId))
        .orderBy(desc(follows.createdAt))
        .limit(limit),
      db
        .select({
          id: posts.id,
          at: posts.createdAt,
          postTitle: posts.title,
          actorUsername: users.username,
          actorWallet: users.walletAddress,
          actorAvatar: users.avatar,
        })
        .from(follows)
        .innerJoin(posts, eq(posts.creatorId, follows.followingId))
        .innerJoin(users, eq(posts.creatorId, users.id))
        .where(and(eq(follows.followerId, userId), eq(posts.isPublished, true)))
        .orderBy(desc(posts.createdAt))
        .limit(limit),
    ]);

  const merged: RawNotification[] = [
    ...unlockRows.map((r) => ({ type: "unlock" as const, ...r })),
    ...tipRows.map((r) => ({ type: "tip" as const, ...r })),
    ...commentRows.map((r) => ({
      type: "comment" as const,
      amount: null,
      postTitle: r.postTitle,
      id: r.id,
      at: r.at,
      actorUsername: r.actorUsername,
      actorWallet: r.actorWallet,
      actorAvatar: r.actorAvatar,
    })),
    ...followRows.map((r) => ({
      type: "follow" as const,
      amount: null,
      postTitle: null,
      id: r.id,
      at: r.at,
      actorUsername: r.actorUsername,
      actorWallet: r.actorWallet,
      actorAvatar: r.actorAvatar,
    })),
    ...postRows.map((r) => ({
      type: "post" as const,
      amount: null,
      postTitle: r.postTitle,
      id: r.id,
      at: r.at,
      actorUsername: r.actorUsername,
      actorWallet: r.actorWallet,
      actorAvatar: r.actorAvatar,
    })),
  ];

  return merged
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, limit);
}
