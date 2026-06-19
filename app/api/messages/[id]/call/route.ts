import { NextRequest, NextResponse } from "next/server";
import {
  getMppCallEscrowStatus,
  normalizeMoney,
  releaseMppCallEscrow,
  reserveMppCallEscrow,
  settleMppCallEscrow,
} from "@/lib/custodial";
import { settleCallWithCustodialWallet } from "@/lib/custodial-wallets";
import { getThreadFor } from "@/lib/db/messages";
import {
  requireCurrentAppUser,
  setAccountCookie,
  unauthorizedJson,
  UnauthorizedError,
} from "@/lib/app-user";
import { TEMPO_TESTNET } from "@/lib/constants";

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

function isTransactionHash(value?: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{64}$/.test(value ?? "");
}

function transactionUrl(txHash?: string) {
  return isTransactionHash(txHash) ? `${TEMPO_TESTNET.explorer}/tx/${txHash}` : null;
}

/**
 * POST /api/messages/[id]/call
 * Server-authorized metered call payments. Active calls reserve balance into
 * escrow on each tick. Ending the call settles the accumulated escrow once on
 * Tempo and records the creator credit after the chain receipt is available.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { action = "settle", callId, tick, chargedSeconds } = (await req.json()) as {
    action?: "reserve" | "settle";
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
  if (action !== "reserve" && action !== "settle") {
    return Response.json({ error: "Invalid call action" }, { status: 400 });
  }
  if (action === "reserve") {
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

  if (action === "reserve") {
    const amount = normalizeMoney(
      (chargedSecondsValue * CALL_RATE_PER_SECOND_USD).toFixed(2),
    );

    const result = await reserveMppCallEscrow({
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
            "WWW-Authenticate": `Payment realm="mpp-call", intent="session", amount="${amount}", currency="AlphaUSD"`,
          },
        },
      );
    }

    return jsonWithAccountCookie(
      {
        status: result.status,
        balance: result.balance,
        escrowedBalance: result.escrowedBalance,
        amount: result.amount,
        chargedSeconds: result.chargedSeconds,
        tick: tickValue,
        mpp: {
          scheme: "Payment",
          intent: "session",
          status: "escrow_reserved",
          currency: "AlphaUSD",
          amount: result.amount,
          intervalSeconds: result.chargedSeconds,
          reference: result.txHash,
        },
      },
      user.id,
    );
  }

  const escrowStatus = await getMppCallEscrowStatus({
    fanId: thread.fanId,
    creatorId: thread.creatorId,
    threadId: thread.id,
    callId,
  });
  if (escrowStatus.status === "settled") {
    return jsonWithAccountCookie(
      {
        status: "already_settled",
        balance: escrowStatus.balance,
        escrowedBalance: escrowStatus.escrowedBalance,
        paymentTxHash: escrowStatus.txHash,
        paymentTxUrl: transactionUrl(escrowStatus.txHash),
        amount: escrowStatus.amount,
        chargedSeconds: Math.round(
          Number(escrowStatus.amount) / CALL_RATE_PER_SECOND_USD,
        ),
        mpp: {
          scheme: "Payment",
          intent: "session",
          status: "receipt",
          currency: "AlphaUSD",
          amount: escrowStatus.amount,
          reference: escrowStatus.txHash,
        },
      },
      user.id,
    );
  }

  if (Number(escrowStatus.amount) <= 0) {
    return jsonWithAccountCookie(
      {
        status: "nothing_to_settle",
        amount: escrowStatus.amount,
        chargedSeconds: 0,
        mpp: {
          scheme: "Payment",
          intent: "session",
          status: "nothing_to_settle",
          currency: "AlphaUSD",
          amount: escrowStatus.amount,
          reference: callId,
        },
      },
      user.id,
    );
  }

  const settlement = await settleCallWithCustodialWallet({
    userId: thread.fanId,
    creatorAddress: thread.creator.walletAddress,
    amountUsd: escrowStatus.amount,
    reference: callId,
  });

  if (!settlement.ok) {
    await releaseMppCallEscrow({
      fanId: thread.fanId,
      threadId: thread.id,
      callId,
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

  const result = await settleMppCallEscrow({
    fanId: thread.fanId,
    creatorId: thread.creatorId,
    threadId: thread.id,
    callId,
    paymentTxHash: settlement.txHash,
  });

  if (result.status === "self_call") {
    return jsonWithAccountCookie(
      { error: "Cannot bill a self call" },
      user.id,
      { status: 400 },
    );
  }
  if (result.status === "nothing_to_settle") {
    return jsonWithAccountCookie(
      {
        status: result.status,
        balance: result.balance,
        escrowedBalance: result.escrowedBalance,
        amount: "0",
        chargedSeconds: 0,
        mpp: {
          scheme: "Payment",
          intent: "session",
          status: "nothing_to_settle",
          currency: "AlphaUSD",
          amount: "0",
          reference: callId,
        },
      },
      user.id,
    );
  }

  return jsonWithAccountCookie(
    {
      status: result.status,
      balance: result.balance,
      escrowedBalance: result.escrowedBalance,
      paymentTxHash: result.txHash,
      paymentTxUrl: transactionUrl(result.txHash),
      amount: result.amount,
      chargedSeconds: Math.round(Number(result.amount) / CALL_RATE_PER_SECOND_USD),
      mpp: {
        scheme: "Payment",
        intent: "session",
        status: "receipt",
        currency: "AlphaUSD",
        amount: result.amount,
        reference: result.txHash,
      },
    },
    user.id,
  );
}
