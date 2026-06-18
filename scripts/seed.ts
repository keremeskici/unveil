// Seed demo creator + posts. Uploads a public blurred preview and a PRIVATE
// full image per post to Vercel Blob, then inserts rows.
//
//   npm run seed
//
// Requires DATABASE_URL and BLOB_READ_WRITE_TOKEN in .env.local.
import { put } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { getDb } from "../lib/db";
import { users, posts } from "../lib/db/schema";
import { makeFull, makePreview } from "./demo-image";

const DEMO_CREATOR_WALLET =
  process.env.DEMO_CREATOR_WALLET?.toLowerCase() ??
  "0x1111111111111111111111111111111111111111";

const DEMO_POSTS = [
  { name: "post1", title: "Golden hour rooftop", price: "0.05", seed: 7 },
  { name: "post2", title: "Backstage, unfiltered", price: "0.10", seed: 13 },
  { name: "post3", title: "The full set", price: "0.25", seed: 23 },
];

async function seed() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  if (!process.env.BLOB_READ_WRITE_TOKEN)
    throw new Error("BLOB_READ_WRITE_TOKEN not set");

  const db = getDb();

  // 1. Creator
  const [creator] = await db
    .insert(users)
    .values({
      walletAddress: DEMO_CREATOR_WALLET,
      username: "demo_creator",
      isCreator: true,
    })
    .onConflictDoUpdate({
      target: users.walletAddress,
      set: { username: "demo_creator", isCreator: true },
    })
    .returning();

  console.log(`creator: ${creator.username} (${creator.id})`);

  // Clear this creator's existing posts so re-running is idempotent.
  await db.delete(posts).where(eq(posts.creatorId, creator.id));

  // 2. Posts
  for (const { name, title, price, seed: s } of DEMO_POSTS) {
    const full = makeFull(s);
    const preview = makePreview(s);

    // Blurred preview — stored private; the feed presigns it server-side with a
    // long TTL (the degraded preview is safe to show, but the store is private).
    const previewBlob = await put(`previews/${name}.png`, preview, {
      access: "private",
      contentType: "image/png",
      allowOverwrite: true,
    });

    // Full media — only reachable via a short-lived signed URL after payment.
    const privateBlob = await put(`media/${name}/original.png`, full, {
      access: "private",
      contentType: "image/png",
      allowOverwrite: true,
    });

    await db
      .insert(posts)
      .values({
        creatorId: creator.id,
        title,
        // Both fields store blob PATHNAMES; presigned on demand.
        blurredPreviewUrl: previewBlob.pathname,
        privateMediaKey: privateBlob.pathname,
        unlockPrice: price,
        mediaType: "image",
        isPublished: true,
      });

    console.log(`post: ${title} — $${price}`);
  }

  console.log("✓ seed complete");
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
