import { NextRequest, NextResponse } from "next/server";
import { getPost } from "@/lib/db/queries";
import { presignPrivateGet } from "@/lib/blob";
import {
  finalizeCustodialUnlockPaymentHash,
  rollbackCustodialUnlock,
  unlockWithCustodialBalance,
} from "@/lib/custodial";
import { POINTS_PER_UNLOCK } from "@/lib/constants";
import {
  requireCurrentAppUser,
  setAccountCookie,
  unauthorizedJson,
  UnauthorizedError,
} from "@/lib/app-user";
import { settleUnlockWithCustodialWallet } from "@/lib/custodial-wallets";
import {
  checkOnChainSpendable,
  getSpendableOnChainUsd,
} from "@/lib/onchain-balance";

// Postgres + Supabase Storage signing need the Node.js runtime.
export const runtime = "nodejs";

function jsonWithAccountCookie(
  body: Record<string, unknown>,
  userId: string,
  init?: ResponseInit,
) {
  return setAccountCookie(NextResponse.json(body, init), userId);
}

export async function POST(req: NextRequest) {
  const {
    postId,
    paymentTxHash,
    walletAddress,
    settlementMs: providedSettlementMs,
    settlementStartedAt,
  } = (await req.json()) as {
    postId?: string;
    paymentTxHash?: string;
    walletAddress?: string;
    settlementMs?: number;
    settlementStartedAt?: number;
  };

  if (!postId) {
    return Response.json({ error: "Missing fields" }, { status: 400 });
  }

  let appUser;
  try {
    appUser = await requireCurrentAppUser();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedJson();
    throw err;
  }

  // 1. Post must exist.
  const post = await getPost(postId);
  if (!post) return Response.json({ error: "Post not found" }, { status: 404 });

  // 2a. Legacy direct Tempo wallet payment remains disabled unless explicitly
  // enabled during the migration window.
  if (
    process.env.ENABLE_LEGACY_TEMPO_WALLET_UNLOCKS === "true" &&
    (paymentTxHash || walletAddress)
  ) {
    const [{ hasUnlocked, recordUnlock, upsertUser }, { verifyTempoPayment }] =
      await Promise.all([import("@/lib/db/queries"), import("@/lib/tempo-server")]);

    if (!paymentTxHash || !walletAddress) {
      return Response.json({ error: "Missing payment proof" }, { status: 400 });
    }

    const fan = await upsertUser(walletAddress);
    const alreadyUnlocked = await hasUnlocked(fan.id, postId);
    if (!alreadyUnlocked) {
      const payment = await verifyTempoPayment(
        paymentTxHash,
        post.unlockPrice,
        walletAddress,
      );
      if (!payment.ok) {
        return Response.json(
          { error: `Payment verification failed: ${payment.reason}` },
          { status: 402 },
        );
      }

      await recordUnlock(
        fan.id,
        postId,
        paymentTxHash,
        post.unlockPrice,
        providedSettlementMs ?? 0,
        String(POINTS_PER_UNLOCK),
      );
    }

    const ttl = post.mediaType === "video" ? 300 : 60;
    const signedUrl = await presignPrivateGet(post.privateMediaKey, ttl);
    return Response.json({
      signedUrl,
      settlementMs: providedSettlementMs ?? 0,
      alreadyUnlocked,
      paymentTxHash,
    });
  }

  if (paymentTxHash || walletAddress) {
    return Response.json({ error: "Legacy wallet unlocks are disabled" }, { status: 400 });
  }

  // 2b. Custodial app-balance path: Clerk identity owns the local ledger row.
  // The on-chain wallet is the spend authority — gate on its live balance.
  const isPaidUnlock = Number(post.unlockPrice) > 0;
  if (isPaidUnlock) {
    const check = await checkOnChainSpendable(appUser.id, post.unlockPrice);
    if (!check.ok) {
      return jsonWithAccountCookie(
        {
          error: "Insufficient balance",
          balance: check.balance,
          required: post.unlockPrice,
        },
        appUser.id,
        { status: 402 },
      );
    }
  }

  const settlementMs = settlementStartedAt ? Date.now() - settlementStartedAt : 0;
  const unlock = await unlockWithCustodialBalance({
    userId: appUser.id,
    postId,
    amount: post.unlockPrice,
    settlementMs,
  });

  if (unlock.status === "insufficient_funds") {
    return jsonWithAccountCookie(
      {
        error: "Insufficient balance",
        balance: unlock.balance,
        required: unlock.required,
      },
      appUser.id,
      { status: 402 },
    );
  }

  if (unlock.status === "unlocked" && isPaidUnlock) {
    const settlement = await settleUnlockWithCustodialWallet({
      userId: appUser.id,
      amountUsd: post.unlockPrice,
      reference: unlock.txHash,
    });
    if (!settlement.ok) {
      await rollbackCustodialUnlock({
        userId: appUser.id,
        postId,
        amount: post.unlockPrice,
        txHash: unlock.txHash,
      });
      return jsonWithAccountCookie(
        {
          error: "Settlement failed",
          settlementError: settlement.reason,
        },
        appUser.id,
        { status: 402 },
      );
    }
    await finalizeCustodialUnlockPaymentHash({
      userId: appUser.id,
      postId,
      internalTxHash: unlock.txHash,
      paymentTxHash: settlement.txHash,
    });
    unlock.txHash = settlement.txHash;
  }

  // 3. Issue a short-lived signed URL for the unblurred media.
  const ttl = post.mediaType === "video" ? 300 : 60;
  const signedUrl = await presignPrivateGet(post.privateMediaKey, ttl);

  const balance =
    unlock.status === "unlocked"
      ? await getSpendableOnChainUsd(appUser.id)
      : undefined;

  return jsonWithAccountCookie(
    {
      signedUrl,
      settlementMs,
      alreadyUnlocked: unlock.status === "already_unlocked",
      balance,
      paymentTxHash: unlock.txHash,
    },
    appUser.id,
  );
}
