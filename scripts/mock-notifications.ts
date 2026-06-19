// Seed mock notifications for two users: the Clerk account
// kerem.eskici@yahoo.com and the cookie-auth dev user. Notifications in this app
// have no table — they're derived from activity on a user's content (unlocks,
// tips, comments, follows). So for each target we:
//   1. give them a couple of published posts (generated media, like reseed), then
//   2. have the existing mock creators unlock, follow, tip, and comment.
// Idempotent: re-running wipes only the rows this script created for each target.
//
//   dotenv -e .env.local -- tsx scripts/mock-notifications.ts
//
// Requires DATABASE_URL + BLOB_READ_WRITE_TOKEN in .env.local.
import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../lib/db";
import {
  users,
  posts,
  unlocks,
  tips,
  comments,
  follows,
} from "../lib/db/schema";
import { uploadPrivate } from "../lib/blob";
import { makeFull, makePreview } from "./demo-image";

const txHash = () => "0x" + randomBytes(32).toString("hex");
const MIN = 60 * 1000;
const ago = (minutes: number) => new Date(Date.now() - minutes * MIN);

// The mock creators (+ a fan) that act ON each target's content.
const ACTOR_USERNAMES = [
  "luna_after_dark",
  "velvet_room",
  "mia_unfiltered",
  "nightshade",
  "coral_bay",
  "demo_fan",
];

type Target = {
  label: string;
  lookup: { by: "clerkId" | "email"; value: string };
  posts: { title: string; price: string; seed: number; minutesAgo: number }[];
};

const TARGETS: Target[] = [
  {
    label: "kerem.eskici@yahoo.com",
    lookup: { by: "email", value: "kerem.eskici@yahoo.com" },
    posts: [
      { title: "Sunlit balcony", price: "0.12", seed: 101, minutesAgo: 3 * 24 * 60 },
      { title: "Off-duty, off-guard", price: "0.20", seed: 137, minutesAgo: 36 * 60 },
    ],
  },
  {
    label: "dev user",
    lookup: { by: "clerkId", value: "dev_default_user" },
    posts: [
      { title: "Studio test shoot", price: "0.10", seed: 211, minutesAgo: 2 * 24 * 60 },
      { title: "Late night edit", price: "0.25", seed: 233, minutesAgo: 20 * 60 },
    ],
  },
];

type Actor = { id: string; username: string };

async function findTarget(t: Target) {
  const db = getDb();
  const [row] = await db
    .select({ id: users.id, username: users.username, email: users.email })
    .from(users)
    .where(
      t.lookup.by === "email"
        ? eq(users.email, t.lookup.value)
        : eq(users.clerkId, t.lookup.value),
    )
    .limit(1);
  return row ?? null;
}

async function seedFor(target: { id: string; username: string | null }, t: Target, actors: Actor[]) {
  const db = getDb();
  const actorIds = actors.map((a) => a.id);
  const titles = t.posts.map((p) => p.title);

  // ── Idempotency: remove only what this script previously created ──────────
  // Deleting the posts cascades their unlocks + comments.
  await db
    .delete(posts)
    .where(and(eq(posts.creatorId, target.id), inArray(posts.title, titles)));
  await db
    .delete(tips)
    .where(and(eq(tips.creatorId, target.id), inArray(tips.fanId, actorIds)));
  await db
    .delete(follows)
    .where(
      and(eq(follows.followingId, target.id), inArray(follows.followerId, actorIds)),
    );
  // Outbound follows (target → creators) drive the "Following" tab (their posts).
  await db
    .delete(follows)
    .where(
      and(eq(follows.followerId, target.id), inArray(follows.followingId, actorIds)),
    );

  // Make the target a creator so the posts/profile are coherent.
  await db.update(users).set({ isCreator: true }).where(eq(users.id, target.id));

  // ── 1. Posts (generated media, published) ────────────────────────────────
  const created: { id: string; price: string }[] = [];
  for (const p of t.posts) {
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

  const actor = (name: string) => actors.find((a) => a.username === name)!;
  const post0 = created[0];
  const post1 = created[1];

  // ── 2. Follows  → "Following" tab ────────────────────────────────────────
  const followPlan: { who: string; minutesAgo: number }[] = [
    { who: "luna_after_dark", minutesAgo: 8 },
    { who: "nightshade", minutesAgo: 95 },
    { who: "coral_bay", minutesAgo: 6 * 60 },
    { who: "mia_unfiltered", minutesAgo: 26 * 60 },
    { who: "velvet_room", minutesAgo: 2 * 24 * 60 },
  ];
  for (const f of followPlan) {
    await db
      .insert(follows)
      .values({
        followerId: actor(f.who).id,
        followingId: target.id,
        createdAt: ago(f.minutesAgo),
      })
      .onConflictDoNothing();
  }

  // Target follows a few creators → their recent posts populate "Following".
  const followingPlan = ["luna_after_dark", "velvet_room", "mia_unfiltered"];
  for (const who of followingPlan) {
    await db
      .insert(follows)
      .values({ followerId: target.id, followingId: actor(who).id })
      .onConflictDoNothing();
  }

  // ── 3. Unlocks  → "Unveiled" tab (with creator-cut amounts) ──────────────
  const unlockPlan: { who: string; post: { id: string; price: string }; minutesAgo: number }[] = [
    { who: "velvet_room", post: post0, minutesAgo: 14 },
    { who: "mia_unfiltered", post: post1, minutesAgo: 52 },
    { who: "coral_bay", post: post0, minutesAgo: 4 * 60 },
    { who: "nightshade", post: post1, minutesAgo: 30 * 60 },
    { who: "demo_fan", post: post0, minutesAgo: 44 * 60 },
  ];
  for (const u of unlockPlan) {
    await db
      .insert(unlocks)
      .values({
        fanId: actor(u.who).id,
        postId: u.post.id,
        paymentTxHash: txHash(),
        amountPaid: u.post.price,
        settlementMs: 300 + Math.round(Number(u.post.price) * 1000),
        unlockedAt: ago(u.minutesAgo),
      })
      .onConflictDoNothing();
  }

  // ── 4. Tips  → "Tips" tab ────────────────────────────────────────────────
  const tipPlan: { who: string; amount: string; message: string; postId: string | null; minutesAgo: number }[] = [
    { who: "luna_after_dark", amount: "5.00", message: "Obsessed with this 🔥", postId: post0.id, minutesAgo: 22 },
    { who: "demo_fan", amount: "2.00", message: "Worth every cent 💸", postId: null, minutesAgo: 70 },
    { who: "coral_bay", amount: "10.00", message: "You're unreal 😍", postId: post1.id, minutesAgo: 8 * 60 },
    { who: "mia_unfiltered", amount: "1.50", message: "keep it coming!", postId: null, minutesAgo: 28 * 60 },
  ];
  for (const tp of tipPlan) {
    await db.insert(tips).values({
      fanId: actor(tp.who).id,
      creatorId: target.id,
      postId: tp.postId,
      amount: tp.amount,
      message: tp.message,
      paymentTxHash: txHash(),
      settlementMs: 280 + Math.round(Number(tp.amount) * 10),
      createdAt: ago(tp.minutesAgo),
    });
  }

  // ── 5. Comments (bonus; derived but not shown in the current filter tabs) ─
  const commentPlan: { who: string; post: { id: string }; body: string; minutesAgo: number }[] = [
    { who: "nightshade", post: post0, body: "This is unreal 😍", minutesAgo: 40 },
    { who: "velvet_room", post: post1, body: "Stunning shot.", minutesAgo: 5 * 60 },
    { who: "coral_bay", post: post0, body: "Need more like this!", minutesAgo: 33 * 60 },
  ];
  for (const c of commentPlan) {
    await db.insert(comments).values({
      postId: c.post.id,
      userId: actor(c.who).id,
      body: c.body,
      createdAt: ago(c.minutesAgo),
    });
  }

  console.log(
    `✓ @${target.username ?? target.id} (${t.label}): ${created.length} posts, ` +
      `${followPlan.length} follows, ${unlockPlan.length} unlocks, ` +
      `${tipPlan.length} tips, ${commentPlan.length} comments`,
  );
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const db = getDb();

  // Resolve actors.
  const actorRows = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(inArray(users.username, ACTOR_USERNAMES));
  const actors: Actor[] = actorRows
    .filter((r): r is Actor => Boolean(r.username))
    .map((r) => ({ id: r.id, username: r.username }));

  const missing = ACTOR_USERNAMES.filter((u) => !actors.some((a) => a.username === u));
  if (missing.length) {
    console.warn(`⚠ missing actor users: ${missing.join(", ")} (run npm run reseed first)`);
  }
  if (actors.length === 0) throw new Error("No actor users found — run the reseed script first.");

  for (const t of TARGETS) {
    const target = await findTarget(t);
    if (!target) {
      console.warn(`⚠ target not found: ${t.label} — skipping`);
      continue;
    }
    await seedFor(target, t, actors);
  }

  console.log("\n✓ mock notifications complete");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
