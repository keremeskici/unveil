import { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { unlocks } from "@/lib/db/schema";
import { getPost, upsertUser, recordUnlock } from "@/lib/db/queries";
import {
  verifyTempoPayment,
  sendCreatorPayout,
  mintLoyalty,
} from "@/lib/tempo-server";
import { presignPrivateGet } from "@/lib/blob";
import { POINTS_PER_UNLOCK, CREATOR_CUT } from "@/lib/constants";

// neon-serverless + @vercel/blob signing need the Node.js runtime.
export const runtime = "nodejs";

const ONCHAIN_REWARDS = process.env.ENABLE_ONCHAIN_REWARDS === "true";

export async function POST(req: NextRequest) {
  const { postId, paymentTxHash, walletAddress, settlementMs } =
    (await req.json()) as {
      postId?: string;
      paymentTxHash?: string;
      walletAddress?: string;
      settlementMs?: number;
    };

  if (!postId || !paymentTxHash || !walletAddress) {
    return Response.json({ error: "Missing fields" }, { status: 400 });
  }

  const db = getDb();

  // 1. Post must exist (with creator, for the payout split).
  const post = await getPost(postId);
  if (!post) return Response.json({ error: "Post not found" }, { status: 404 });

  // 2. Ensure the fan has a user record (create on first interaction).
  const fan = await upsertUser(walletAddress);

  // 3. Idempotency — already unlocked? Re-issue a signed URL.
  const existing = await db.query.unlocks.findFirst({
    where: and(eq(unlocks.fanId, fan.id), eq(unlocks.postId, postId)),
  });
  if (existing) {
    const signedUrl = await presignPrivateGet(post.privateMediaKey, 300);
    return Response.json({ signedUrl, alreadyUnlocked: true });
  }

  // 4. Verify payment on-chain.
  const isValid = await verifyTempoPayment(
    paymentTxHash,
    post.unlockPrice,
    walletAddress,
  );
  if (!isValid) {
    return Response.json({ error: "Payment not verified" }, { status: 402 });
  }

  // 5. Record unlock + loyalty points (atomic, off-chain ledger).
  await recordUnlock(
    fan.id,
    postId,
    paymentTxHash,
    post.unlockPrice,
    settlementMs ?? 0,
    String(POINTS_PER_UNLOCK),
  );

  // 6. Optional on-chain rewards — creator payout split + loyalty mint.
  //    Best-effort: failures here never block the content reveal. Off when
  //    ENABLE_ONCHAIN_REWARDS !== "true" (needs a funded platform wallet +
  //    deployed VEIL token).
  const creatorAddress = post.creator?.walletAddress;
  const creatorPayout = parseFloat(post.unlockPrice) * CREATOR_CUT;
  let rewards: { payout?: unknown; loyalty?: unknown } | undefined;
  if (ONCHAIN_REWARDS) {
    const [payout, loyalty] = await Promise.allSettled([
      creatorAddress
        ? sendCreatorPayout(creatorAddress, creatorPayout, paymentTxHash)
        : Promise.resolve({ ok: false, reason: "no creator address" }),
      mintLoyalty(walletAddress, POINTS_PER_UNLOCK),
    ]);
    rewards = {
      payout: payout.status === "fulfilled" ? payout.value : { ok: false },
      loyalty: loyalty.status === "fulfilled" ? loyalty.value : { ok: false },
    };
  }

  // 7. Issue a short-lived signed URL for the unblurred media.
  const ttl = post.mediaType === "video" ? 300 : 60;
  const signedUrl = await presignPrivateGet(post.privateMediaKey, ttl);

  return Response.json({
    signedUrl,
    settlementMs,
    split: {
      creator: Number(creatorPayout.toFixed(6)),
      platform: Number(
        (parseFloat(post.unlockPrice) - creatorPayout).toFixed(6),
      ),
    },
    rewards,
  });
}
