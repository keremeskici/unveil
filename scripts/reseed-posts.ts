// Wipe EVERY post from the database and reseed the feed with a set of mock
// creators, each with a few posts. Generates the blurred preview + full image
// per post procedurally and uploads them to the active private storage backend
// (Vercel Blob here). Also gives the dev user a small unlocked collection and a
// DM so the rest of the app looks populated.
//
//   npm run reseed      (or: dotenv -e .env.local -- tsx scripts/reseed-posts.ts)
//
// Requires DATABASE_URL + BLOB_READ_WRITE_TOKEN in .env.local.
import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../lib/db";
import {
  users,
  posts,
  unlocks,
  loyaltyLedger,
  threads,
  messages,
} from "../lib/db/schema";
import { POINTS_PER_UNLOCK } from "../lib/constants";
import { uploadPrivate } from "../lib/blob";
import { makeFull, makePreview } from "./demo-image";

const DEV_USER_WALLET =
  process.env.DEV_USER_WALLET?.toLowerCase() ??
  "0x3333333333333333333333333333333333333333";

type MockPost = { title: string; price: string; seed: number };
type MockCreator = {
  wallet: string;
  username: string;
  displayName: string;
  posts: MockPost[];
};

// Five mock creators with a spread of free + paid posts.
const CREATORS: MockCreator[] = [
  {
    wallet: "0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
    username: "luna_after_dark",
    displayName: "Luna After Dark",
    posts: [
      { title: "Golden hour rooftop", price: "0.05", seed: 7 },
      { title: "Midnight in the city", price: "0.10", seed: 12 },
      { title: "The full set", price: "0.25", seed: 23 },
    ],
  },
  {
    wallet: "0xb2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2",
    username: "velvet_room",
    displayName: "The Velvet Room",
    posts: [
      { title: "Backstage, unfiltered", price: "0.08", seed: 31 },
      { title: "Velvet & candlelight", price: "0.15", seed: 44 },
      { title: "After the show", price: "0.30", seed: 58 },
    ],
  },
  {
    wallet: "0xc3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3",
    username: "mia_unfiltered",
    displayName: "Mia Unfiltered",
    posts: [
      { title: "Lazy Sunday morning", price: "0", seed: 5 },
      { title: "Coffee & quiet", price: "0.06", seed: 17 },
      { title: "Just for you", price: "0.20", seed: 29 },
    ],
  },
  {
    wallet: "0xd4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4",
    username: "nightshade",
    displayName: "Nightshade",
    posts: [
      { title: "Neon nights", price: "0.12", seed: 63 },
      { title: "Shadow play", price: "0.18", seed: 71 },
      { title: "Locked & loaded", price: "0.50", seed: 88 },
    ],
  },
  {
    wallet: "0xe5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5",
    username: "coral_bay",
    displayName: "Coral Bay",
    posts: [
      { title: "Beach day tease", price: "0", seed: 41 },
      { title: "Sunset swim", price: "0.07", seed: 52 },
      { title: "Private island", price: "0.22", seed: 67 },
    ],
  },
];

const txHash = () => "0x" + randomBytes(32).toString("hex");
const HOUR = 60 * 60 * 1000;

async function reseed() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");

  const db = getDb();

  // 1. Remove EVERY post. Cascades likes/saves/comments/unlocks/regions; nulls
  //    out PPV messages + blur-job post references.
  const deleted = await db.delete(posts).returning({ id: posts.id });
  console.log(`deleted ${deleted.length} existing post(s)`);

  // PPV DM cards whose post just got nulled would render as empty bubbles — drop
  // them so old conversations stay clean.
  const orphaned = await db
    .delete(messages)
    .where(and(eq(messages.kind, "ppv"), isNull(messages.postId)))
    .returning({ id: messages.id });
  console.log(`removed ${orphaned.length} orphaned PPV message(s)`);

  // 2. Upsert the mock creators.
  const creatorIds = new Map<string, string>();
  for (const c of CREATORS) {
    const [row] = await db
      .insert(users)
      .values({
        walletAddress: c.wallet,
        username: c.username,
        displayName: c.displayName,
        isCreator: true,
      })
      .onConflictDoUpdate({
        target: users.walletAddress,
        set: { username: c.username, displayName: c.displayName, isCreator: true },
      })
      .returning();
    creatorIds.set(c.username, row.id);
    console.log(`creator: @${c.username} (${row.id})`);
  }

  // Dev user (the cookie-auth identity) — receives the collection + a DM.
  const [devUser] = await db
    .insert(users)
    .values({
      walletAddress: DEV_USER_WALLET,
      clerkId: "dev_default_user",
      email: "dev@unveil.local",
      displayName: "Dev User",
      username: "dev_user",
    })
    .onConflictDoUpdate({
      target: users.clerkId,
      set: { email: "dev@unveil.local", displayName: "Dev User", username: "dev_user" },
    })
    .returning();

  // 3. Interleave creators so the feed mixes them, newest first. Each post gets
  //    generated media + a staggered timestamp.
  const ordered: { creator: MockCreator; post: MockPost }[] = [];
  const maxPosts = Math.max(...CREATORS.map((c) => c.posts.length));
  for (let round = 0; round < maxPosts; round++) {
    for (const c of CREATORS) {
      const post = c.posts[round];
      if (post) ordered.push({ creator: c, post });
    }
  }

  const now = Date.now();
  const created: { id: string; price: string; creator: string; title: string }[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const { creator, post } = ordered[i];
    const full = makeFull(post.seed);
    const preview = makePreview(post.seed);

    const previewBlob = await uploadPrivate(
      `previews/${creator.username}-${post.seed}.png`,
      preview,
      { contentType: "image/png", upsert: true },
    );
    const privateBlob = await uploadPrivate(
      `media/${creator.username}-${post.seed}/original.png`,
      full,
      { contentType: "image/png", upsert: true },
    );

    const [row] = await db
      .insert(posts)
      .values({
        creatorId: creatorIds.get(creator.username)!,
        title: post.title,
        blurredPreviewUrl: previewBlob.pathname,
        privateMediaKey: privateBlob.pathname,
        unlockPrice: post.price,
        mediaType: "image",
        isPublished: true,
        createdAt: new Date(now - i * 3 * HOUR),
      })
      .returning();
    created.push({
      id: row.id,
      price: post.price,
      creator: creator.username,
      title: post.title,
    });
    console.log(
      `post: @${creator.username} — "${post.title}" $${post.price}`,
    );
  }

  // 4. Dev user unlocks a few paid posts → seeds the profile Collection + the
  //    creators' "unveiled" notifications + a loyalty balance.
  const paid = created.filter((p) => Number(p.price) > 0).slice(0, 3);
  const unlockedIds = new Set(paid.map((p) => p.id));
  for (const p of paid) {
    const hash = txHash();
    const [unlock] = await db
      .insert(unlocks)
      .values({
        fanId: devUser.id,
        postId: p.id,
        paymentTxHash: hash,
        amountPaid: p.price,
        settlementMs: 300 + Math.round(Number(p.price) * 1000),
      })
      .onConflictDoNothing()
      .returning();
    if (unlock) {
      await db.insert(loyaltyLedger).values({
        userId: devUser.id,
        amount: String(POINTS_PER_UNLOCK),
        eventType: "post_unlock",
        referenceId: unlock.id,
        txHash: hash,
      });
    }
  }
  console.log(`unlocks: ${paid.length} (dev user collection)`);

  // 5. A DM from the first creator to the dev user, including one PPV card for a
  //    post the dev user has NOT unlocked — so it renders behind the paywall
  //    (locked, with a price + "MPP unlock" button) instead of pre-revealed.
  //    Rebuild the thread from scratch so re-runs stay idempotent.
  const dmCreatorId = creatorIds.get(CREATORS[0].username)!;
  const ppvPost = created.find(
    (p) =>
      p.creator === CREATORS[0].username &&
      Number(p.price) > 0 &&
      !unlockedIds.has(p.id),
  );

  await db
    .delete(threads)
    .where(
      and(eq(threads.creatorId, dmCreatorId), eq(threads.fanId, devUser.id)),
    );

  const [thread] = await db
    .insert(threads)
    .values({ creatorId: dmCreatorId, fanId: devUser.id })
    .returning();

  if (thread) {
    const base = now - 5 * 60 * 1000;
    const script = [
      { senderId: dmCreatorId, kind: "text" as const, body: "Hey you — welcome in 💋", postId: null as string | null },
      { senderId: devUser.id, kind: "text" as const, body: "Been waiting for this. Show me everything.", postId: null },
      ...(ppvPost
        ? [{ senderId: dmCreatorId, kind: "ppv" as const, body: "A little something just for you 🔥", postId: ppvPost.id }]
        : []),
      { senderId: dmCreatorId, kind: "text" as const, body: "Let me know what you think 😘", postId: null },
    ];
    for (let i = 0; i < script.length; i++) {
      await db.insert(messages).values({
        threadId: thread.id,
        senderId: script[i].senderId,
        kind: script[i].kind,
        body: script[i].body,
        postId: script[i].postId,
        createdAt: new Date(base + i * 1000),
      });
    }
    await db
      .update(threads)
      .set({ lastMessageAt: new Date(base + script.length * 1000) })
      .where(eq(threads.id, thread.id));
    console.log(`dm thread: ${thread.id} (${script.length} messages)`);
  }

  console.log(
    `\n✓ reseed complete — ${created.length} posts across ${CREATORS.length} creators`,
  );
}

reseed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
