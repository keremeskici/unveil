import { NextRequest, NextResponse } from "next/server";
import { getPost } from "@/lib/db/queries";
import { normalizeMoney, tipWithCustodialBalance } from "@/lib/custodial";
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

  const result = await tipWithCustodialBalance({
    fanId: user.id,
    creatorId: post.creatorId,
    postId,
    amount: normalized,
    message: message?.trim() || null,
    settlementMs,
  });

  if (result.status === "self_tip") {
    return jsonWithAccountCookie(
      { error: "You can't tip your own post" },
      user.id,
      { status: 400 },
    );
  }

  if (result.status === "insufficient_funds") {
    return jsonWithAccountCookie(
      {
        error: "Insufficient balance",
        balance: result.balance,
        required: result.required,
      },
      user.id,
      { status: 402 },
    );
  }

  return jsonWithAccountCookie(
    {
      status: "sent",
      balance: result.balance,
      paymentTxHash: result.txHash,
      settlementMs,
    },
    user.id,
  );
}
