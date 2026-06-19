import { NextRequest, NextResponse } from "next/server";
import {
  chargeMppCallTick,
  normalizeMoney,
  rollbackMppCallTick,
} from "@/lib/custodial";
import { settleCallWithCustodialWallet } from "@/lib/custodial-wallets";
import { getThreadFor } from "@/lib/db/messages";
import {
  requireCurrentAppUser,
  setAccountCookie,
  unauthorizedJson,
  UnauthorizedError,
} from "@/lib/app-user";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const CALL_RATE_PER_SECOND_USD = 0.05;
const MAX_CALL_SECONDS = 60 * 60;

function jsonWithAccountCookie(
  body: Record<string, unknown>,
  userId: string,
  init?: ResponseInit,
) {
  return setAccountCookie(NextResponse.json(body, init), userId);
}

function paymentChallenge({
  amount,
  balance,
  required,
}: {
  amount: string;
  balance: string;
  required: string;
}) {
  return {
    error: "Insufficient balance",
    balance,
    required,
    mpp: {
      scheme: "Payment",
      intent: "session",
      status: "payment_required",
      currency: "AlphaUSD",
      amount,
      required,
    },
  };
}

/**
 * POST /api/messages/[id]/call
 * Server-authorized metered call settlement. The fan is debited and the creator
 * is credited once per {callId,tick}; insufficient balance returns 402.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { callId, tick, chargedSeconds } = (await req.json()) as {
    callId?: string;
    tick?: number;
    chargedSeconds?: number;
  };
  const tickValue = typeof tick === "number" ? tick : NaN;
  const chargedSecondsValue =
    typeof chargedSeconds === "number" ? chargedSeconds : NaN;

  if (!callId || !/^[a-zA-Z0-9_-]{8,80}$/.test(callId)) {
    return Response.json({ error: "Invalid callId" }, { status: 400 });
  }
  if (!Number.isInteger(tickValue) || tickValue < 1) {
    return Response.json({ error: "Invalid tick" }, { status: 400 });
  }
  if (
    !Number.isInteger(chargedSecondsValue) ||
    chargedSecondsValue < 1 ||
    chargedSecondsValue > MAX_CALL_SECONDS
  ) {
    return Response.json({ error: "Invalid call duration" }, { status: 400 });
  }

  let user;
  try {
    user = await requireCurrentAppUser();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedJson();
    throw err;
  }

  const thread = await getThreadFor(user.id, id);
  if (!thread) return Response.json({ error: "Thread not found" }, { status: 404 });
  if (thread.fanId !== user.id) {
    return jsonWithAccountCookie(
      { error: "Only the fan can pay for metered calls" },
      user.id,
      { status: 403 },
    );
  }

  const amount = normalizeMoney(
    (chargedSecondsValue * CALL_RATE_PER_SECOND_USD).toFixed(2),
  );

  const result = await chargeMppCallTick({
    fanId: thread.fanId,
    creatorId: thread.creatorId,
    threadId: thread.id,
    callId,
    tick: tickValue,
    chargedSeconds: chargedSecondsValue,
    amount,
  });

  if (result.status === "self_call") {
    return jsonWithAccountCookie(
      { error: "Cannot bill a self call" },
      user.id,
      { status: 400 },
    );
  }

  if (result.status === "insufficient_funds") {
    return jsonWithAccountCookie(
      paymentChallenge({
        amount,
        balance: result.balance,
        required: result.required,
      }),
      user.id,
      {
        status: 402,
        headers: {
          "WWW-Authenticate": `Payment realm="mpp-call", amount="${amount}", currency="AlphaUSD"`,
        },
      },
    );
  }

  if (result.status === "charged") {
    const settlement = await settleCallWithCustodialWallet({
      userId: thread.fanId,
      creatorAddress: thread.creator.walletAddress,
      amountUsd: result.amount,
      reference: result.txHash,
    });

    if (!settlement.ok) {
      await rollbackMppCallTick({
        fanId: thread.fanId,
        amount: result.amount,
        reference: result.txHash,
      });
      return jsonWithAccountCookie(
        {
          error: "Call settlement failed",
          detail: settlement.reason,
        },
        user.id,
        { status: 402 },
      );
    }

    result.txHash = settlement.txHash;
  }

  return jsonWithAccountCookie(
    {
      status: result.status,
      balance: result.balance,
      paymentTxHash: result.txHash,
      amount: result.amount,
      chargedSeconds: result.chargedSeconds,
      tick: tickValue,
      mpp: {
        scheme: "Payment",
        intent: "session",
        status: "receipt",
        currency: "AlphaUSD",
        amount: result.amount,
        intervalSeconds: result.chargedSeconds,
        reference: result.txHash,
      },
    },
    user.id,
  );
}
