import { NextRequest, NextResponse } from "next/server";
import { getPost } from "@/lib/db/queries";
import { normalizeMoney, tipWithCustodialBalance } from "@/lib/custodial";
import {
  getOrCreateCustodialWallet,
  settleTipWithCustodialWallet,
} from "@/lib/custodial-wallets";
import {
  checkOnChainSpendable,
  getSpendableOnChainUsd,
} from "@/lib/onchain-balance";
import {
  requireCurrentAppUser,
  setAccountCookie,
  unauthorizedJson,
  UnauthorizedError,
} from "@/lib/app-user";

export const runtime = "nodejs";

function jsonWithAccountCookie(
  body: Record<string, unknown>,
  userId: string,
  init?: ResponseInit,
) {
  return setAccountCookie(NextResponse.json(body, init), userId);
}

/**
 * POST /api/tip — send a tip to a post's creator from the custodial balance.
 * Body: { postId, amount, message?, settlementStartedAt? }
 */
export async function POST(req: NextRequest) {
  const { postId, amount, message, settlementStartedAt } = (await req.json()) as {
    postId?: string;
    amount?: string | number;
    message?: string;
    settlementStartedAt?: number;
  };

  if (!postId) {
    return Response.json({ error: "Missing post" }, { status: 400 });
  }

  let user;
  try {
    user = await requireCurrentAppUser();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedJson();
    throw err;
  }

  const post = await getPost(postId);
  if (!post) return Response.json({ error: "Post not found" }, { status: 404 });

  let normalized: string;
  try {
    normalized = normalizeMoney(amount);
  } catch {
    return Response.json({ error: "Invalid tip amount" }, { status: 400 });
  }

  const settlementMs = settlementStartedAt
    ? Date.now() - settlementStartedAt
    : 0;

  if (user.id === post.creatorId) {
    return jsonWithAccountCookie(
      { error: "You can't tip your own post" },
      user.id,
      { status: 400 },
    );
  }

  // The on-chain wallet is the spend authority — gate on its live balance.
  const check = await checkOnChainSpendable(user.id, normalized);
  if (!check.ok) {
    return jsonWithAccountCookie(
      {
        error: "Insufficient balance",
        balance: check.balance,
        required: normalized,
      },
      user.id,
      { status: 402 },
    );
  }

  // Move the tip on-chain (fan custodial wallet → creator custodial wallet),
  // then mirror it into the ledger for history + loyalty.
  const creatorWallet = await getOrCreateCustodialWallet(post.creatorId);
  const settlement = await settleTipWithCustodialWallet({
    userId: user.id,
    creatorAddress: creatorWallet.address,
    amountUsd: normalized,
    reference: postId,
  });
  if (!settlement.ok) {
    return jsonWithAccountCookie(
      { error: "Settlement failed", settlementError: settlement.reason },
      user.id,
      { status: 402 },
    );
  }

  const result = await tipWithCustodialBalance({
    fanId: user.id,
    creatorId: post.creatorId,
    postId,
    amount: normalized,
    message: message?.trim() || null,
    settlementMs,
    paymentTxHash: settlement.txHash,
  });

  if (result.status === "self_tip") {
    return jsonWithAccountCookie(
      { error: "You can't tip your own post" },
      user.id,
      { status: 400 },
    );
  }

  const balance = await getSpendableOnChainUsd(user.id);
  return jsonWithAccountCookie(
    {
      status: "sent",
      balance,
      paymentTxHash: settlement.txHash,
      settlementMs,
    },
    user.id,
  );
}
