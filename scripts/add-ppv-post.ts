// Add ONE fresh, not-yet-unlocked PPV card to the dev user's DM with
// luna_after_dark, so there's always a locked post to test the unlock flow on.
// Run after any change to the unlock UI:
//
//   npm run new-post   (or: dotenv -e .env.local -- tsx scripts/add-ppv-post.ts)
//
// Unlike `npm run reseed`, this is purely additive — it deletes nothing and only
// uploads the one new post's media. Each run generates a different-looking image
// (random seed) and appends a locked card to the bottom of the thread.
//
// Requires DATABASE_URL + BLOB_READ_WRITE_TOKEN in .env.local.
import { and, eq } from "drizzle-orm";
import { getDb } from "../lib/db";
import { users, posts, threads, messages } from "../lib/db/schema";
import { uploadPrivate } from "../lib/blob";
import { makeFull, makePreview } from "./demo-image";

const DEV_USER_WALLET =
  process.env.DEV_USER_WALLET?.toLowerCase() ??
  "0x3333333333333333333333333333333333333333";
const CREATOR_WALLET = "0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1";
const PRICES = ["0.05", "0.10", "0.25"];

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const db = getDb();

  // Creator (luna_after_dark) + dev user — upsert so this works even on a fresh DB.
  const [creator] = await db
    .insert(users)
    .values({
      walletAddress: CREATOR_WALLET,
      username: "luna_after_dark",
      displayName: "Luna After Dark",
      isCreator: true,
    })
    .onConflictDoUpdate({ target: users.walletAddress, set: { isCreator: true } })
    .returning();

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
      set: { email: "dev@unveil.local" },
    })
    .returning();

  // Fresh media + price each run so cards are visually distinct and re-testable.
  const seed = Math.floor(Math.random() * 100000);
  const price = PRICES[seed % PRICES.length];
  const previewBlob = await uploadPrivate(
    `previews/fresh-${seed}.png`,
    makePreview(seed),
    { contentType: "image/png", upsert: true },
  );
  const privateBlob = await uploadPrivate(
    `media/fresh-${seed}/original.png`,
    makeFull(seed),
    { contentType: "image/png", upsert: true },
  );

  const [post] = await db
    .insert(posts)
    .values({
      creatorId: creator.id,
      title: `Fresh tease #${seed}`,
      blurredPreviewUrl: previewBlob.pathname,
      privateMediaKey: privateBlob.pathname,
      unlockPrice: price,
      mediaType: "image",
      isPublished: true,
    })
    .returning();

  // Find or create the dev ↔ creator thread, then append a locked PPV card.
  let [thread] = await db
    .select()
    .from(threads)
    .where(and(eq(threads.creatorId, creator.id), eq(threads.fanId, devUser.id)))
    .limit(1);
  if (!thread) {
    [thread] = await db
      .insert(threads)
      .values({ creatorId: creator.id, fanId: devUser.id })
      .returning();
  }

  await db.insert(messages).values({
    threadId: thread.id,
    senderId: creator.id,
    kind: "ppv",
    body: "A little something just for you 🔥",
    postId: post.id,
  });
  await db
    .update(threads)
    .set({ lastMessageAt: new Date() })
    .where(eq(threads.id, thread.id));

  console.log(
    `✓ added locked PPV card — "${post.title}" ($${price}) → thread ${thread.id}`,
  );
  console.log(`  open /messages/${thread.id} and unlock it.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
