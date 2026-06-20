import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  getCustodialAccount,
  getMppCallEscrowStatus,
  normalizeMoney,
  releaseMppCallEscrow,
  reserveMppCallEscrow,
  settleMppCallEscrow,
} from "@/lib/custodial";
import { settleCallWithCustodialWallet } from "@/lib/custodial-wallets";
import {
  ActiveCallSessionError,
  connectCallSession,
  createCallSession,
  getScopedCallSession,
  isActiveCallStatus,
  markCallSessionEnding,
  markCallSessionFailed,
  markCallSessionReleased,
  markCallSessionSettled,
  recordCallSessionSettlementTx,
  updateCallSessionReservedSecond,
  withCallSessionLock,
  type CallSession,
} from "@/lib/db/calls";
import { getThreadFor, sendCallMessage } from "@/lib/db/messages";
import {
  requireCurrentAppUser,
  setAccountCookie,
  unauthorizedJson,
  UnauthorizedError,
} from "@/lib/app-user";
import { TEMPO_TESTNET } from "@/lib/constants";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };
type CallAction = "start" | "connect" | "reserve" | "settle" | "release";

const CALL_RATE_PER_SECOND_USD = 0.05;
const DEFAULT_RESERVE_INTERVAL_SECONDS = 5;
const DEFAULT_MIN_START_BALANCE_SECONDS = 10;
const MAX_CALL_SECONDS = 60 * 60;

function jsonWithAccountCookie(
  body: Record<string, unknown>,
  userId: string,
  init?: ResponseInit,
) {
  return setAccountCookie(NextResponse.json(body, init), userId);
}

function noStoreJson(
  body: Record<string, unknown>,
  userId: string,
  init?: ResponseInit,
) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return jsonWithAccountCookie(body, userId, { ...init, headers });
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

function paymentRequiredHeaders(amount: string) {
  return {
    "WWW-Authenticate": `Payment realm="mpp-call", intent="session", amount="${amount}", currency="AlphaUSD"`,
  };
}

function callAmount(seconds: number) {
  return normalizeMoney((seconds * CALL_RATE_PER_SECOND_USD).toFixed(2));
}

function minStartBalanceSeconds() {
  const value = Number(process.env.ELEVENLABS_MIN_START_BALANCE_SECONDS);
  return Number.isInteger(value) && value > 0
    ? value
    : DEFAULT_MIN_START_BALANCE_SECONDS;
}

function reserveIntervalSeconds() {
  const value = Number(process.env.ELEVENLABS_CALL_RESERVE_INTERVAL_SECONDS);
  return Number.isInteger(value) && value > 0
    ? value
    : DEFAULT_RESERVE_INTERVAL_SECONDS;
}

function callMetadata(callId: string) {
  return {
    callId,
    ratePerSecondUsd: CALL_RATE_PER_SECOND_USD,
    currency: "AlphaUSD",
    reserveIntervalSeconds: reserveIntervalSeconds(),
    minStartBalanceSeconds: minStartBalanceSeconds(),
    maxSeconds: MAX_CALL_SECONDS,
  };
}

function isValidCallId(value?: string): value is string {
  return /^[a-zA-Z0-9_-]{8,80}$/.test(value ?? "");
}

function isTransactionHash(value?: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{64}$/.test(value ?? "");
}

function transactionUrl(txHash?: string) {
  return isTransactionHash(txHash) ? `${TEMPO_TESTNET.explorer}/tx/${txHash}` : null;
}

function billableSeconds(session: CallSession, endedAt = new Date()) {
  if (!session.connectedAt) return 0;
  const elapsed = Math.floor(
    (endedAt.getTime() - session.connectedAt.getTime()) / 1000,
  );
  return Math.min(Math.max(elapsed, 0), MAX_CALL_SECONDS);
}

function sessionResponse(session: CallSession, extra?: Record<string, unknown>) {
  return {
    status: session.status,
    call: {
      ...callMetadata(session.id),
      threadId: session.threadId,
      status: session.status,
      connectedAt: session.connectedAt?.toISOString() ?? null,
      endedAt: session.endedAt?.toISOString() ?? null,
      elevenConversationId: session.elevenConversationId,
      lastReservedSecond: session.lastReservedSecond,
      settledSeconds: session.settledSeconds,
      settledAmount: session.settledAmount,
      settlementTxHash: session.settlementTxHash,
    },
    ...extra,
  };
}

async function minimumBalanceChallenge(userId: string) {
  const required = callAmount(minStartBalanceSeconds());
  const account = await getCustodialAccount(userId);
  const balance = account?.availableBalance ?? "0";
  if (Number(balance) >= Number(required)) return null;
  return { required, balance };
}

async function reserveSecondsForSession({
  session,
  fanId,
  creatorId,
  threadId,
  seconds,
  tick,
}: {
  session: CallSession;
  fanId: string;
  creatorId: string;
  threadId: string;
  seconds: number;
  tick: number;
}) {
  const amount = callAmount(seconds);
  const result = await reserveMppCallEscrow({
    fanId,
    creatorId,
    threadId,
    callId: session.id,
    tick,
    chargedSeconds: seconds,
    amount,
  });

  if (result.status === "reserved" || result.status === "already_reserved") {
    await updateCallSessionReservedSecond(session.id, tick);
  }

  return { amount, result };
}

async function legacyReserve({
  userId,
  thread,
  callId,
  tick,
  chargedSeconds,
}: {
  userId: string;
  thread: NonNullable<Awaited<ReturnType<typeof getThreadFor>>>;
  callId: string;
  tick: number;
  chargedSeconds: number;
}) {
  const amount = callAmount(chargedSeconds);
  const result = await reserveMppCallEscrow({
    fanId: thread.fanId,
    creatorId: thread.creatorId,
    threadId: thread.id,
    callId,
    tick,
    chargedSeconds,
    amount,
  });

  if (result.status === "self_call") {
    return noStoreJson({ error: "Cannot bill a self call" }, userId, {
      status: 400,
    });
  }

  if (result.status === "insufficient_funds") {
    return noStoreJson(
      paymentChallenge({
        amount,
        balance: result.balance,
        required: result.required,
      }),
      userId,
      { status: 402, headers: paymentRequiredHeaders(amount) },
    );
  }

  return noStoreJson(
    {
      status: result.status,
      balance: result.balance,
      escrowedBalance: result.escrowedBalance,
      amount: result.amount,
      chargedSeconds: result.chargedSeconds,
      tick,
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
    userId,
  );
}

async function legacySettle({
  userId,
  thread,
  callId,
}: {
  userId: string;
  thread: NonNullable<Awaited<ReturnType<typeof getThreadFor>>>;
  callId: string;
}) {
  const escrowStatus = await getMppCallEscrowStatus({
    fanId: thread.fanId,
    creatorId: thread.creatorId,
    threadId: thread.id,
    callId,
  });

  if (escrowStatus.status === "settled") {
    return noStoreJson(
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
      userId,
    );
  }

  if (Number(escrowStatus.amount) <= 0) {
    return noStoreJson(
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
      userId,
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
    return noStoreJson(
      {
        error: "Call settlement failed",
        detail: settlement.reason,
      },
      userId,
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
    return noStoreJson({ error: "Cannot bill a self call" }, userId, {
      status: 400,
    });
  }
  if (result.status === "nothing_to_settle") {
    return noStoreJson(
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
      userId,
    );
  }

  return noStoreJson(
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
    userId,
  );
}

/**
 * POST /api/messages/[id]/call
 *
 * Durable ElevenLabs paid-call billing. New clients use start → connect →
 * reserve → settle/release. Legacy clients that only send reserve/settle with
 * client-computed seconds still follow the previous idempotent ledger path.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    action?: CallAction;
    callId?: string;
    tick?: number;
    chargedSeconds?: number;
    conversationId?: string;
    elevenConversationId?: string;
  };
  const action = body.action ?? "settle";
  const requestedCallId = body.callId ?? (action === "start" ? randomUUID() : null);
  const tickValue = typeof body.tick === "number" ? body.tick : NaN;
  const chargedSecondsValue =
    typeof body.chargedSeconds === "number" ? body.chargedSeconds : NaN;

  if (!["start", "connect", "reserve", "settle", "release"].includes(action)) {
    return Response.json({ error: "Invalid call action" }, { status: 400 });
  }
  if (!isValidCallId(requestedCallId ?? undefined)) {
    return Response.json({ error: "Invalid callId" }, { status: 400 });
  }
  const callId = requestedCallId!;

  if (action === "reserve") {
    if (Number.isFinite(tickValue) && (!Number.isInteger(tickValue) || tickValue < 1)) {
      return Response.json({ error: "Invalid tick" }, { status: 400 });
    }
    if (
      Number.isFinite(chargedSecondsValue) &&
      (!Number.isInteger(chargedSecondsValue) ||
        chargedSecondsValue < 1 ||
        chargedSecondsValue > MAX_CALL_SECONDS)
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
    return noStoreJson(
      { error: "Only the fan can pay for metered calls" },
      user.id,
      { status: 403 },
    );
  }

  if (action === "start") {
    const challenge = await minimumBalanceChallenge(user.id);
    if (challenge) {
      return noStoreJson(
        paymentChallenge({
          amount: challenge.required,
          balance: challenge.balance,
          required: challenge.required,
        }),
        user.id,
        { status: 402, headers: paymentRequiredHeaders(challenge.required) },
      );
    }

    try {
      const session = await createCallSession({
        callId,
        threadId: thread.id,
        fanId: thread.fanId,
        creatorId: thread.creatorId,
      });
      return noStoreJson(sessionResponse(session, { status: "started" }), user.id);
    } catch (err) {
      if (err instanceof ActiveCallSessionError) {
        return noStoreJson(
          sessionResponse(err.session, {
            error: "An active call already exists for this thread",
          }),
          user.id,
          { status: 409 },
        );
      }
      throw err;
    }
  }

  if (action === "connect") {
    let existing;
    try {
      existing =
        (await getScopedCallSession({
          callId,
          threadId: thread.id,
          fanId: thread.fanId,
        })) ??
        (await createCallSession({
          callId,
          threadId: thread.id,
          fanId: thread.fanId,
          creatorId: thread.creatorId,
        }));
    } catch (err) {
      if (err instanceof ActiveCallSessionError) {
        return noStoreJson(
          sessionResponse(err.session, {
            error: "An active call already exists for this thread",
          }),
          user.id,
          { status: 409 },
        );
      }
      throw err;
    }
    if (!isActiveCallStatus(existing.status)) {
      return noStoreJson(sessionResponse(existing), user.id, { status: 409 });
    }

    const session = await connectCallSession({
      callId,
      threadId: thread.id,
      fanId: thread.fanId,
      creatorId: thread.creatorId,
      elevenConversationId: body.elevenConversationId ?? body.conversationId,
    });
    return noStoreJson(sessionResponse(session, { status: "connected" }), user.id);
  }

  const session = await getScopedCallSession({
    callId,
    threadId: thread.id,
    fanId: thread.fanId,
  });

  if (!session) {
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
      return legacyReserve({
        userId: user.id,
        thread,
        callId,
        tick: tickValue,
        chargedSeconds: chargedSecondsValue,
      });
    }
    if (action === "settle") {
      return legacySettle({ userId: user.id, thread, callId });
    }
    if (action === "release") {
      await releaseMppCallEscrow({
        fanId: thread.fanId,
        threadId: thread.id,
        callId,
      });
      return noStoreJson({ status: "released", call: callMetadata(callId) }, user.id);
    }
  }

  if (!session) {
    return Response.json({ error: "Call session not found" }, { status: 404 });
  }

  if (action === "reserve") {
    return withCallSessionLock(callId, async () => {
      const current = await getScopedCallSession({
        callId,
        threadId: thread.id,
        fanId: thread.fanId,
      });
      if (!current) {
        return Response.json({ error: "Call session not found" }, { status: 404 });
      }
      if (!current.connectedAt) {
        return noStoreJson(sessionResponse(current, { error: "Call not connected" }), user.id, {
          status: 409,
        });
      }
      if (["settled", "released", "failed"].includes(current.status)) {
        return noStoreJson(sessionResponse(current), user.id);
      }

      const reservedThroughSecond = billableSeconds(current);
      const secondsToReserve = reservedThroughSecond - current.lastReservedSecond;
      if (secondsToReserve < 1) {
        return noStoreJson(
          sessionResponse(current, {
            status: "up_to_date",
            chargedSeconds: 0,
            totalReservedSeconds: current.lastReservedSecond,
          }),
          user.id,
        );
      }

      const { amount, result } = await reserveSecondsForSession({
        session: current,
        fanId: thread.fanId,
        creatorId: thread.creatorId,
        threadId: thread.id,
        seconds: secondsToReserve,
        tick: reservedThroughSecond,
      });

      if (result.status === "self_call") {
        return noStoreJson({ error: "Cannot bill a self call" }, user.id, {
          status: 400,
        });
      }
      if (result.status === "insufficient_funds") {
        return noStoreJson(
          paymentChallenge({
            amount,
            balance: result.balance,
            required: result.required,
          }),
          user.id,
          { status: 402, headers: paymentRequiredHeaders(amount) },
        );
      }

      return noStoreJson(
        sessionResponse(
          {
            ...current,
            lastReservedSecond: reservedThroughSecond,
          },
          {
            status: result.status,
            balance: result.balance,
            escrowedBalance: result.escrowedBalance,
            amount: result.amount,
            chargedSeconds: result.chargedSeconds,
            totalReservedSeconds: reservedThroughSecond,
            tick: reservedThroughSecond,
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
        ),
        user.id,
      );
    });
  }

  if (action === "release") {
    return withCallSessionLock(callId, async () => {
      const endedAt = new Date();
      await releaseMppCallEscrow({
        fanId: thread.fanId,
        threadId: thread.id,
        callId,
      });
      const released = await markCallSessionReleased({
        callId,
        endedAt,
        reason: "client_release",
      });
      return noStoreJson(
        sessionResponse(released ?? session, {
          status: "released",
          amount: "0",
          chargedSeconds: 0,
        }),
        user.id,
      );
    });
  }

  return withCallSessionLock(callId, async () => {
    const current = await getScopedCallSession({
      callId,
      threadId: thread.id,
      fanId: thread.fanId,
    });
    if (!current) {
      return Response.json({ error: "Call session not found" }, { status: 404 });
    }

    const endedAt = current.endedAt ?? new Date();
    if (current.status === "settled" && current.settlementTxHash) {
      const escrowStatus = await getMppCallEscrowStatus({
        fanId: thread.fanId,
        creatorId: thread.creatorId,
        threadId: thread.id,
        callId,
      });
      return noStoreJson(
        sessionResponse(current, {
          status: "already_settled",
          paymentTxHash: current.settlementTxHash,
          paymentTxUrl: transactionUrl(current.settlementTxHash),
          amount: current.settledAmount ?? escrowStatus.amount,
          chargedSeconds: current.settledSeconds ?? billableSeconds(current, endedAt),
          mpp: {
            scheme: "Payment",
            intent: "session",
            status: "receipt",
            currency: "AlphaUSD",
            amount: current.settledAmount ?? escrowStatus.amount,
            reference: current.settlementTxHash,
          },
        }),
        user.id,
      );
    }
    if (current.status === "released" || current.status === "failed") {
      return noStoreJson(sessionResponse(current), user.id);
    }

    if (!current.connectedAt) {
      await releaseMppCallEscrow({
        fanId: thread.fanId,
        threadId: thread.id,
        callId,
      });
      const released = await markCallSessionReleased({
        callId,
        endedAt,
        reason: "never_connected",
      });
      return noStoreJson(
        sessionResponse(released ?? current, {
          status: "released",
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
        }),
        user.id,
      );
    }

    const settledSeconds = billableSeconds(current, endedAt);

    // The call connected (never-connected returns above). Log a WhatsApp-style
    // "Voice call · mm:ss" bubble into the thread exactly once — on the first
    // settle that ends this session. A retry (e.g. after an insufficient-funds
    // stall leaves the row in "ending") re-enters here, so we gate on the
    // pre-ending status to avoid posting the bubble twice.
    if (current.status !== "ending") {
      await sendCallMessage({
        threadId: thread.id,
        senderId: thread.fanId,
        seconds: settledSeconds,
      });
    }

    await markCallSessionEnding({ callId, endedAt });
    const finalReserveSeconds = settledSeconds - current.lastReservedSecond;
    if (finalReserveSeconds > 0) {
      const { amount, result } = await reserveSecondsForSession({
        session: current,
        fanId: thread.fanId,
        creatorId: thread.creatorId,
        threadId: thread.id,
        seconds: finalReserveSeconds,
        tick: settledSeconds,
      });
      if (result.status === "insufficient_funds") {
        return noStoreJson(
          paymentChallenge({
            amount,
            balance: result.balance,
            required: result.required,
          }),
          user.id,
          { status: 402, headers: paymentRequiredHeaders(amount) },
        );
      }
      if (result.status === "self_call") {
        return noStoreJson({ error: "Cannot bill a self call" }, user.id, {
          status: 400,
        });
      }
    }

    let escrowStatus = await getMppCallEscrowStatus({
      fanId: thread.fanId,
      creatorId: thread.creatorId,
      threadId: thread.id,
      callId,
    });

    if (escrowStatus.status === "settled") {
      const settled = await markCallSessionSettled({
        callId,
        endedAt,
        settledSeconds,
        settledAmount: escrowStatus.amount,
        settlementTxHash: escrowStatus.txHash,
      });
      return noStoreJson(
        sessionResponse(settled ?? current, {
          status: "already_settled",
          balance: escrowStatus.balance,
          escrowedBalance: escrowStatus.escrowedBalance,
          paymentTxHash: escrowStatus.txHash,
          paymentTxUrl: transactionUrl(escrowStatus.txHash),
          amount: escrowStatus.amount,
          chargedSeconds: settledSeconds,
          mpp: {
            scheme: "Payment",
            intent: "session",
            status: "receipt",
            currency: "AlphaUSD",
            amount: escrowStatus.amount,
            reference: escrowStatus.txHash,
          },
        }),
        user.id,
      );
    }

    if (Number(escrowStatus.amount) <= 0) {
      const released = await markCallSessionReleased({
        callId,
        endedAt,
        reason: "no_billable_seconds",
      });
      return noStoreJson(
        sessionResponse(released ?? current, {
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
        }),
        user.id,
      );
    }

    let paymentTxHash = current.settlementTxHash ?? undefined;
    if (!paymentTxHash) {
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
        await markCallSessionFailed({
          callId,
          endedAt,
          reason: settlement.reason,
        });
        return noStoreJson(
          {
            error: "Call settlement failed",
            detail: settlement.reason,
          },
          user.id,
          { status: 402 },
        );
      }

      paymentTxHash = settlement.txHash;
      await recordCallSessionSettlementTx({
        callId,
        settlementTxHash: paymentTxHash,
      });
    }

    const result = await settleMppCallEscrow({
      fanId: thread.fanId,
      creatorId: thread.creatorId,
      threadId: thread.id,
      callId,
      paymentTxHash,
    });

    if (result.status === "self_call") {
      return noStoreJson({ error: "Cannot bill a self call" }, user.id, {
        status: 400,
      });
    }
    if (result.status === "nothing_to_settle") {
      const released = await markCallSessionReleased({
        callId,
        endedAt,
        reason: "no_billable_seconds",
      });
      return noStoreJson(
        sessionResponse(released ?? current, {
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
        }),
        user.id,
      );
    }

    const settled = await markCallSessionSettled({
      callId,
      endedAt,
      settledSeconds,
      settledAmount: result.amount,
      settlementTxHash: result.txHash,
    });

    escrowStatus = {
      status: "settled",
      amount: result.amount,
      txHash: result.txHash,
      balance: result.balance,
      escrowedBalance: result.escrowedBalance,
    };

    return noStoreJson(
      sessionResponse(settled ?? current, {
        status: result.status,
        balance: escrowStatus.balance,
        escrowedBalance: escrowStatus.escrowedBalance,
        paymentTxHash: result.txHash,
        paymentTxUrl: transactionUrl(result.txHash),
        amount: result.amount,
        chargedSeconds: settledSeconds,
        mpp: {
          scheme: "Payment",
          intent: "session",
          status: "receipt",
          currency: "AlphaUSD",
          amount: result.amount,
          reference: result.txHash,
        },
      }),
      user.id,
    );
  });
}
