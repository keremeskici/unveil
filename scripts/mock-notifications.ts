// Seed mock notifications for the signed-in test account(s).
//
// Notifications in this app have no table — they're DERIVED from activity on a
// user's content (unlocks, tips, comments, follows) plus new posts from the
// creators the user follows (see lib/db/queries.ts > getNotifications). So to
// make the Notifications tab non-empty we:
//   1. give the target a couple of PAID posts (so "Unveiled" unlocks carry an
//      amount), then
//   2. have real existing users unlock, tip, comment on, and follow them, and
//   3. follow a few creators who have posts (populates the "Following" tab).
//
// Actors + follow-creators are resolved DYNAMICALLY from whatever users exist in
// the DB, so this keeps working across reseeds/re-themes (the old hardcoded
// creator names did not). Idempotent: re-running wipes only the rows it created.
//
//   npm run mock-notifications
//   (or: dotenv -e .env.local -- tsx scripts/mock-notifications.ts)
//
// Requires DATABASE_URL + BLOB_READ_WRITE_TOKEN in .env.local.
import { randomBytes } from "node:crypto";
import { and, count, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { getDb } from "../lib/db";
import { users, posts, unlocks, tips, comments, follows } from "../lib/db/schema";
import { uploadPrivate } from "../lib/blob";
import { makeFull, makePreview } from "./demo-image";

const txHash = () => "0x" + randomBytes(32).toString("hex");
const MIN = 60 * 1000;
const ago = (minutes: number) => new Date(Date.now() - minutes * MIN);

// Whose Notifications tab to populate. The signed-in Clerk account by default.
const TARGET_EMAILS = ["12345678910.kerem@gmail.com"];

// Two paid posts so unlocks/tips have a price to settle against.
const TARGET_POSTS = [
  { title: "Buzzer-beater, every angle", price: "3.00", seed: 101, minutesAgo: 3 * 24 * 60 },
  { title: "Full-time tactical breakdown", price: "4.00", seed: 137, minutesAgo: 36 * 60 },
];

type Actor = { id: string; username: string };

/** Real users (with a wallet, so name/avatar render) to act on the target. */
async function resolveFanActors(targetId: string, n: number): Promise<Actor[]> {
  const db = getDb();
  const rows = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(
      and(
        ne(users.id, targetId),
        isNotNull(users.username),
        isNotNull(users.walletAddress),
      ),
    )
    .orderBy(desc(users.createdAt))
    .limit(n);
  return rows.filter((r): r is Actor => Boolean(r.username));
}

/** Creators who already have published posts → feed the "Following" tab. */
async function resolveFollowCreators(targetId: string, n: number): Promise<Actor[]> {
  const db = getDb();
  const rows = await db
    .select({ id: users.id, username: users.username, posts: count(posts.id) })
    .from(users)
    .innerJoin(
      posts,
      and(eq(posts.creatorId, users.id), eq(posts.isPublished, true)),
    )
    .where(and(eq(users.isCreator, true), ne(users.id, targetId)))
    .groupBy(users.id, users.username)
    .orderBy(desc(count(posts.id)))
    .limit(n);
  return rows
    .filter((r): r is Actor & { posts: number } => Boolean(r.username))
    .map((r) => ({ id: r.id, username: r.username }));
}

async function seedFor(target: { id: string; username: string | null; email: string | null }) {
  const db = getDb();
  const fans = await resolveFanActors(target.id, 6);
  const followCreators = await resolveFollowCreators(target.id, 5);
  if (fans.length === 0) throw new Error("No candidate actor users found in DB.");

  const fanIds = fans.map((f) => f.id);
  const creatorIds = followCreators.map((c) => c.id);
  const titles = TARGET_POSTS.map((p) => p.title);

  // ── Idempotency: remove only what this script previously created ──────────
  // Deleting the posts cascades their unlocks + comments.
  await db
    .delete(posts)
    .where(and(eq(posts.creatorId, target.id), inArray(posts.title, titles)));
  await db
    .delete(tips)
    .where(and(eq(tips.creatorId, target.id), inArray(tips.fanId, fanIds)));
  // Inbound follows (fans → target) and outbound follows (target → creators).
  await db
    .delete(follows)
    .where(and(eq(follows.followingId, target.id), inArray(follows.followerId, fanIds)));
  if (creatorIds.length)
    await db
      .delete(follows)
      .where(and(eq(follows.followerId, target.id), inArray(follows.followingId, creatorIds)));

  // Make the target a creator so the posts/profile are coherent.
  await db.update(users).set({ isCreator: true }).where(eq(users.id, target.id));

  // ── 1. Two paid posts (generated media, published) ────────────────────────
  const created: { id: string; price: string }[] = [];
  for (const p of TARGET_POSTS) {
    const previewBlob = await uploadPrivate(
      `previews/mocknotif-${target.id}-${p.seed}.png`,
      makePreview(p.seed),
      { contentType: "image/png", upsert: true },
    );
    const privateBlob = await uploadPrivate(
      `media/mocknotif-${target.id}-${p.seed}/original.png`,
      makeFull(p.seed),
      { contentType: "image/png", upsert: true },
    );
    const [row] = await db
      .insert(posts)
      .values({
        creatorId: target.id,
        title: p.title,
        blurredPreviewUrl: previewBlob.pathname,
        privateMediaKey: privateBlob.pathname,
        unlockPrice: p.price,
        mediaType: "image",
        isPublished: true,
        createdAt: ago(p.minutesAgo),
      })
      .returning();
    created.push({ id: row.id, price: p.price });
  }
  const [post0, post1] = created;

  // ── 2. Inbound follows → grow the "Fans" count ────────────────────────────
  const followMinutes = [8, 95, 6 * 60, 26 * 60, 2 * 24 * 60, 4 * 24 * 60];
  for (let i = 0; i < fans.length; i++) {
    await db
      .insert(follows)
      .values({
        followerId: fans[i].id,
        followingId: target.id,
        createdAt: ago(followMinutes[i] ?? (i + 1) * 90),
      })
      .onConflictDoNothing();
  }

  // Target follows creators → their recent posts populate "Following".
  for (const c of followCreators) {
    await db
      .insert(follows)
      .values({ followerId: target.id, followingId: c.id })
      .onConflictDoNothing();
  }

  // ── 3. Unlocks → "Unveiled" tab (carry a creator-cut amount) ──────────────
  const unlockPlan = [
    { fan: fans[0], post: post0, minutesAgo: 14 },
    { fan: fans[1], post: post1, minutesAgo: 52 },
    { fan: fans[2], post: post0, minutesAgo: 4 * 60 },
    { fan: fans[3], post: post1, minutesAgo: 30 * 60 },
    { fan: fans[4], post: post0, minutesAgo: 44 * 60 },
  ].filter((u) => u.fan);
  for (const u of unlockPlan) {
    await db
      .insert(unlocks)
      .values({
        fanId: u.fan.id,
        postId: u.post.id,
        paymentTxHash: txHash(),
        amountPaid: u.post.price,
        // Sub-second settlement is the "proof of magic" — keep it fast.
        settlementMs: 300 + Math.floor(Math.random() * 400),
        unlockedAt: ago(u.minutesAgo),
      })
      .onConflictDoNothing();
  }

  // ── 4. Tips → "Tips" tab ──────────────────────────────────────────────────
  const tipPlan = [
    { fan: fans[0], amount: "5.00", message: "Best breakdown on here 🔥", postId: post0.id, minutesAgo: 22 },
    { fan: fans[1], amount: "2.00", message: "Worth every cent 💸", postId: null as string | null, minutesAgo: 70 },
    { fan: fans[2], amount: "10.00", message: "Replay GOAT 🐐", postId: post1.id, minutesAgo: 8 * 60 },
    { fan: fans[3], amount: "1.50", message: "keep these coming!", postId: null, minutesAgo: 28 * 60 },
  ].filter((t) => t.fan);
  for (const tp of tipPlan) {
    await db.insert(tips).values({
      fanId: tp.fan.id,
      creatorId: target.id,
      postId: tp.postId,
      amount: tp.amount,
      message: tp.message,
      paymentTxHash: txHash(),
      settlementMs: 280 + Math.round(Number(tp.amount) * 10),
      createdAt: ago(tp.minutesAgo),
    });
  }

  // ── 5. Comments (derived; not in the current filter tabs, but coherent) ───
  const commentPlan = [
    { fan: fans[0], post: post0, body: "That angle is unreal 😍", minutesAgo: 40 },
    { fan: fans[1], post: post1, body: "Textbook spacing.", minutesAgo: 5 * 60 },
    { fan: fans[2], post: post0, body: "Need more like this!", minutesAgo: 33 * 60 },
  ].filter((c) => c.fan);
  for (const c of commentPlan) {
    await db.insert(comments).values({
      postId: c.post.id,
      userId: c.fan.id,
      body: c.body,
      createdAt: ago(c.minutesAgo),
    });
  }

  console.log(
    `✓ @${target.username ?? target.id} (${target.email}): ` +
      `${created.length} posts, ${fans.length} fans, ${unlockPlan.length} unlocks, ` +
      `${tipPlan.length} tips, ${commentPlan.length} comments, ` +
      `following ${followCreators.length} creators ` +
      `[actors: ${fans.map((f) => "@" + f.username).join(", ")}]`,
  );
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const db = getDb();

  const targets = await db
    .select({ id: users.id, username: users.username, email: users.email })
    .from(users)
    .where(inArray(users.email, TARGET_EMAILS));

  const found = new Set(targets.map((t) => t.email));
  for (const e of TARGET_EMAILS) {
    if (!found.has(e)) console.warn(`⚠ target not found: ${e} — skipping`);
  }
  if (targets.length === 0) throw new Error("No target users found for the configured emails.");

  for (const t of targets) await seedFor(t);

  console.log("\n✓ mock notifications complete");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
