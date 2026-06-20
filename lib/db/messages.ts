import { eq, and, or, ne, desc, isNull, inArray, count, sql } from "drizzle-orm";
import { getDb } from "./index";
import { threads, messages, users, posts, unlocks } from "./schema";
import { persistUnlockOwnership } from "../unlock-ownership";

/** Columns we expose for a conversation participant. */
const participantCols = {
  id: true,
  username: true,
  avatar: true,
  walletAddress: true,
} as const;

export type MessageKind = "text" | "ppv" | "call";

/**
 * Find the fan↔creator thread, creating it on first contact. The unique index
 * on (creator_id, fan_id) makes this race-safe: a concurrent caller hits the
 * ON CONFLICT and we read the winning row back.
 */
export async function getOrCreateThread(creatorId: string, fanId: string) {
  const db = getDb();
  const [created] = await db
    .insert(threads)
    .values({ creatorId, fanId })
    .onConflictDoNothing({ target: [threads.creatorId, threads.fanId] })
    .returning();
  if (created) return created;
  const existing = await db.query.threads.findFirst({
    where: and(eq(threads.creatorId, creatorId), eq(threads.fanId, fanId)),
  });
  return existing!;
}

/** A thread the user participates in, with both identities. Null if absent or
 *  the user isn't a participant (authorization). */
export async function getThreadFor(userId: string, threadId: string) {
  const db = getDb();
  const thread = await db.query.threads.findFirst({
    where: eq(threads.id, threadId),
    with: {
      creator: { columns: participantCols },
      fan: { columns: participantCols },
    },
  });
  if (!thread) return null;
  if (thread.creatorId !== userId && thread.fanId !== userId) return null;
  return thread;
}

/**
 * Inbox for a user — every thread they're in (as creator or fan), newest
 * activity first, each with the other participant, a last-message preview, and
 * the unread count. Volume is tiny (a creator's DMs), so we resolve previews in
 * one pass over the threads' messages rather than a correlated subquery.
 */
export async function listThreads(userId: string) {
  const db = getDb();
  const rows = await db.query.threads.findMany({
    where: or(eq(threads.creatorId, userId), eq(threads.fanId, userId)),
    with: {
      creator: { columns: participantCols },
      fan: { columns: participantCols },
    },
    orderBy: [desc(threads.lastMessageAt)],
    limit: 50,
  });
  if (rows.length === 0) return [];

  const ids = rows.map((t) => t.id);

  // Latest message per thread (reduce a desc-ordered scan — few rows).
  const recent = await db
    .select({
      threadId: messages.threadId,
      kind: messages.kind,
      body: messages.body,
      senderId: messages.senderId,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(inArray(messages.threadId, ids))
    .orderBy(desc(messages.createdAt));
  const last = new Map<string, (typeof recent)[number]>();
  for (const m of recent) if (!last.has(m.threadId)) last.set(m.threadId, m);

  // Unread = messages the *other* party sent that this user hasn't read.
  const unreadRows = await db
    .select({ threadId: messages.threadId, n: count() })
    .from(messages)
    .where(
      and(
        inArray(messages.threadId, ids),
        ne(messages.senderId, userId),
        isNull(messages.readAt),
      ),
    )
    .groupBy(messages.threadId);
  const unread = new Map(unreadRows.map((r) => [r.threadId, Number(r.n)]));

  return rows.map((t) => {
    const other = t.creatorId === userId ? t.fan : t.creator;
    const lm = last.get(t.id);
    const preview = !lm
      ? "Say hello 👋"
      : lm.kind === "ppv"
        ? "🔒 Locked content"
        : lm.kind === "call"
          ? "📞 Voice call"
          : (lm.body ?? "");
    return {
      id: t.id,
      lastMessageAt: t.lastMessageAt,
      other,
      preview,
      unread: unread.get(t.id) ?? 0,
    };
  });
}

/**
 * Messages in a thread, oldest first. For PPV messages we left-join the post
 * and the viewer's own unlock so the caller can decide, per message, whether to
 * presign the real media (viewer paid) or just the blurred preview.
 */
export async function getMessages(threadId: string, viewerId: string) {
  const db = getDb();
  const persistOwnership = persistUnlockOwnership();
  return db
    .select({
      id: messages.id,
      kind: messages.kind,
      body: messages.body,
      senderId: messages.senderId,
      createdAt: messages.createdAt,
      postId: messages.postId,
      postTitle: posts.title,
      blurredPreviewUrl: posts.blurredPreviewUrl,
      privateMediaKey: posts.privateMediaKey,
      unlockPrice: posts.unlockPrice,
      mediaType: posts.mediaType,
      // non-null when THIS viewer has unlocked the referenced post
      viewerUnlockId: persistOwnership ? unlocks.id : sql<string | null>`null`,
    })
    .from(messages)
    .leftJoin(posts, eq(messages.postId, posts.id))
    .leftJoin(
      unlocks,
      and(eq(unlocks.postId, messages.postId), eq(unlocks.fanId, viewerId)),
    )
    .where(eq(messages.threadId, threadId))
    .orderBy(messages.createdAt);
}

/** Append a message and bump the thread's activity timestamp. */
export async function sendMessage(input: {
  threadId: string;
  senderId: string;
  kind?: MessageKind;
  body?: string | null;
  postId?: string | null;
}) {
  const db = getDb();
  const [msg] = await db
    .insert(messages)
    .values({
      threadId: input.threadId,
      senderId: input.senderId,
      kind: input.kind ?? "text",
      body: input.body ?? null,
      postId: input.postId ?? null,
    })
    .returning();
  await db
    .update(threads)
    .set({ lastMessageAt: new Date() })
    .where(eq(threads.id, input.threadId));
  return msg;
}

/**
 * Log a WhatsApp-style "Voice call" event in a thread once a paid call ends.
 * The connected duration (seconds) is stashed in `body`; the sender is the fan
 * who placed the call, so it renders as outgoing on their side.
 */
export async function sendCallMessage(input: {
  threadId: string;
  senderId: string;
  seconds: number;
}) {
  return sendMessage({
    threadId: input.threadId,
    senderId: input.senderId,
    kind: "call",
    body: String(Math.max(0, Math.round(input.seconds))),
  });
}

/** Mark every message the *other* party sent in this thread as read. */
export async function markThreadRead(threadId: string, userId: string) {
  const db = getDb();
  await db
    .update(messages)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(messages.threadId, threadId),
        ne(messages.senderId, userId),
        isNull(messages.readAt),
      ),
    );
}

/** Total unread messages across all of a user's threads (for the nav badge). */
export async function countUnreadMessages(userId: string): Promise<number> {
  const db = getDb();
  const [r] = await db
    .select({ n: count() })
    .from(messages)
    .innerJoin(threads, eq(messages.threadId, threads.id))
    .where(
      and(
        or(eq(threads.creatorId, userId), eq(threads.fanId, userId)),
        ne(messages.senderId, userId),
        isNull(messages.readAt),
      ),
    );
  return Number(r?.n ?? 0);
}
