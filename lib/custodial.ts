import { and, eq, sql } from "drizzle-orm";
import { getDb } from "./db";
import {
  custodialLedger,
  loyaltyLedger,
  paymentDeposits,
  regionUnlocks,
  tips,
  unlocks,
  userBalances,
  users,
} from "./db/schema";
import { POINTS_PER_UNLOCK } from "./constants";
import {
  internalAddress,
  internalReference,
  internalTxHash,
} from "./custodial/identifiers";
import {
  mppCallReserveReference,
  mppCallReserveReferenceLike,
  mppCallSettleReference,
} from "./custodial/mpp-call-references";
export { normalizeMoney } from "./custodial/money";

export const CUSTODIAL_ACCOUNT_COOKIE = "veil_account";

export type CustodialAccount = {
  userId: string;
  availableBalance: string;
  escrowedBalance: string;
};

export type CustodialUnlockResult =
  | { status: "already_unlocked"; txHash?: string }
  | { status: "unlocked"; txHash: string; balance: string }
  | { status: "insufficient_funds"; balance: string; required: string };

export type TopUpDepositResult =
  | {
      status: "credited";
      userId: string;
      depositId: string;
      amount: string;
      availableBalance: string;
    }
  | {
      status: "already_processed";
      userId?: string;
      depositId?: string;
      amount?: string;
      availableBalance: string;
    };

export type TopUpFundingPreparation =
  | {
      status: "funding_pending";
      userId: string;
      depositId: string;
      provider: string;
      providerSessionId: string;
      providerTransactionId?: string | null;
      amount: string;
      currency: string;
      destinationWalletAddress?: string | null;
    }
  | {
      status: "already_processed";
      userId: string;
      depositId: string;
      amount: string;
      availableBalance: string;
      destinationWalletAddress?: string | null;
      tempoFundingTxHash?: string | null;
    };

export async function createCustodialAccount(): Promise<CustodialAccount> {
  return getDb().transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ walletAddress: internalAddress() })
      .returning();

    const [balance] = await tx
      .insert(userBalances)
      .values({ userId: user.id })
      .returning();

    return {
      userId: user.id,
      availableBalance: balance.availableBalance,
      escrowedBalance: balance.escrowedBalance,
    };
  });
}

export async function getCustodialAccount(
  userId: string | undefined,
): Promise<CustodialAccount | null> {
  if (!userId) return null;

  const db = getDb();
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return null;

  const balance = await db.query.userBalances.findFirst({
    where: eq(userBalances.userId, user.id),
  });

  if (!balance) {
    const [created] = await db
      .insert(userBalances)
      .values({ userId: user.id })
      .onConflictDoNothing()
      .returning();

    return {
      userId: user.id,
      availableBalance: created?.availableBalance ?? "0",
      escrowedBalance: created?.escrowedBalance ?? "0",
    };
  }

  return {
    userId: user.id,
    availableBalance: balance.availableBalance,
    escrowedBalance: balance.escrowedBalance,
  };
}

export async function getOrCreateCustodialAccount(userId: string | undefined) {
  return (await getCustodialAccount(userId)) ?? createCustodialAccount();
}

export async function recordPendingCardDeposit({
  userId,
  amount,
  currency,
  providerSessionId,
  provider = "stripe_onramp",
  destinationWalletAddress,
  metadata,
}: {
  userId: string;
  amount: string;
  currency: string;
  providerSessionId: string;
  provider?: string;
  destinationWalletAddress?: string;
  metadata?: Record<string, unknown>;
}) {
  const [deposit] = await getDb()
    .insert(paymentDeposits)
    .values({
      userId,
      provider,
      amount,
      currency: currency.toLowerCase(),
      providerSessionId,
      destinationWalletAddress,
      metadata: metadata ?? {},
      status: "pending",
    })
    .onConflictDoNothing()
    .returning();

  return deposit;
}

export async function createPendingTopUpDeposit({
  userId,
  amount,
  currency,
  provider,
  providerSessionId,
  destinationWalletAddress,
  metadata,
}: {
  userId: string;
  amount: string;
  currency: string;
  provider: string;
  providerSessionId: string;
  destinationWalletAddress?: string;
  metadata?: Record<string, unknown>;
}) {
  const deposit = await recordPendingCardDeposit({
    userId,
    amount,
    currency,
    provider,
    providerSessionId,
    destinationWalletAddress,
    metadata,
  });
  if (!deposit) {
    throw new Error("Deposit session already exists");
  }
  return deposit;
}

export async function creditTopUpDeposit({
  userId,
  depositId,
  amount,
  currency,
  provider,
  providerSessionId,
  providerPaymentIntentId,
  providerTransactionId,
  providerCustomerId,
  providerPaymentMethodId,
  rawProviderEvent,
}: {
  userId: string;
  depositId?: string;
  amount: string;
  currency: string;
  provider: string;
  providerSessionId: string;
  providerPaymentIntentId?: string;
  providerTransactionId?: string;
  providerCustomerId?: string;
  providerPaymentMethodId?: string;
  rawProviderEvent?: Record<string, unknown>;
}): Promise<TopUpDepositResult> {
  return getDb().transaction(async (tx) => {
    await tx
      .insert(paymentDeposits)
      .values({
        userId,
        provider,
        amount,
        currency: currency.toLowerCase(),
        providerSessionId,
        providerPaymentIntentId,
        providerTransactionId,
        providerCustomerId,
        providerPaymentMethodId,
        metadata: rawProviderEvent ? { rawProviderEvent } : {},
        status: "pending",
      })
      .onConflictDoNothing();

    const whereClause = depositId
      ? and(eq(paymentDeposits.id, depositId), eq(paymentDeposits.status, "pending"))
      : and(
          eq(paymentDeposits.providerSessionId, providerSessionId),
          eq(paymentDeposits.status, "pending"),
        );

    const [deposit] = await tx
      .update(paymentDeposits)
      .set({
        providerPaymentIntentId,
        providerTransactionId,
        providerCustomerId,
        providerPaymentMethodId,
        status: "succeeded",
        creditedAt: new Date(),
        updatedAt: new Date(),
        metadata: rawProviderEvent ? { rawProviderEvent } : undefined,
      })
      .where(whereClause)
      .returning();

    if (!deposit) {
      const current = await tx.query.userBalances.findFirst({
        where: eq(userBalances.userId, userId),
      });
      return {
        status: "already_processed" as const,
        userId,
        depositId,
        amount,
        availableBalance: current?.availableBalance ?? "0",
      };
    }

    await tx.insert(userBalances).values({ userId }).onConflictDoNothing();

    const [balance] = await tx
      .update(userBalances)
      .set({
        availableBalance: sql`${userBalances.availableBalance} + ${amount}`,
        updatedAt: new Date(),
      })
      .where(eq(userBalances.userId, userId))
      .returning();

    await tx.insert(custodialLedger).values({
      userId,
      eventType: "deposit",
      amount,
      balanceAfter: balance.availableBalance,
      reference: `${provider}:${providerTransactionId ?? providerSessionId}`,
    });

    return {
      status: "credited" as const,
      userId,
      depositId: deposit.id,
      amount,
      availableBalance: balance.availableBalance,
    };
  });
}

export async function creditCardDeposit({
  userId,
  amount,
  currency,
  providerSessionId,
  providerPaymentIntentId,
}: {
  userId: string;
  amount: string;
  currency: string;
  providerSessionId: string;
  providerPaymentIntentId?: string;
}) {
  return creditTopUpDeposit({
    userId,
    amount,
    currency,
    provider: "stripe_onramp",
    providerSessionId,
    providerPaymentIntentId,
  });
}

export async function creditExistingTopUpDeposit({
  depositId,
  provider,
  providerTransactionId,
  providerCustomerId,
  providerPaymentMethodId,
  amount,
  currency,
  rawProviderEvent,
}: {
  depositId: string;
  provider: string;
  providerTransactionId: string;
  providerCustomerId?: string;
  providerPaymentMethodId?: string;
  amount?: string;
  currency?: string;
  rawProviderEvent?: Record<string, unknown>;
}) {
  return prepareTopUpDepositFunding({
    depositId,
    provider,
    providerTransactionId,
    providerCustomerId,
    providerPaymentMethodId,
    amount,
    currency,
    rawProviderEvent,
  });
}

export async function prepareTopUpDepositFunding({
  depositId,
  provider,
  providerTransactionId,
  providerCustomerId,
  providerPaymentMethodId,
  amount,
  currency,
  rawProviderEvent,
}: {
  depositId: string;
  provider: string;
  providerTransactionId: string;
  providerCustomerId?: string;
  providerPaymentMethodId?: string;
  amount?: string;
  currency?: string;
  rawProviderEvent?: Record<string, unknown>;
}): Promise<TopUpFundingPreparation> {
  const deposit = await getDb().query.paymentDeposits.findFirst({
    where: eq(paymentDeposits.id, depositId),
  });
  if (!deposit) throw new Error("Deposit not found");
  if (deposit.provider !== provider) throw new Error("Deposit provider mismatch");

  const receivedAmount = amount ? Number(amount) : Number(deposit.amount);
  const expectedAmount = Number(deposit.amount);
  if (
    !Number.isFinite(receivedAmount) ||
    receivedAmount + 0.00000001 < expectedAmount
  ) {
    throw new Error("Provider amount is less than the pending deposit amount");
  }

  if (deposit.status === "succeeded") {
    const current = await getDb().query.userBalances.findFirst({
      where: eq(userBalances.userId, deposit.userId),
    });
    return {
      status: "already_processed",
      userId: deposit.userId,
      depositId: deposit.id,
      amount: deposit.amount,
      availableBalance: current?.availableBalance ?? "0",
      destinationWalletAddress: deposit.destinationWalletAddress,
      tempoFundingTxHash: deposit.tempoFundingTxHash,
    };
  }

  if (!["pending", "funding_pending", "funding_failed"].includes(deposit.status)) {
    throw new Error(`Deposit cannot be funded from status ${deposit.status}`);
  }

  const metadata = {
    ...(deposit.metadata ?? {}),
    ...(rawProviderEvent ? { rawProviderEvent } : {}),
  };

  const [updated] = await getDb()
    .update(paymentDeposits)
    .set({
      providerTransactionId,
      providerCustomerId,
      providerPaymentMethodId,
      currency: (currency ?? deposit.currency).toLowerCase(),
      status: "funding_pending",
      metadata,
      updatedAt: new Date(),
    })
    .where(eq(paymentDeposits.id, deposit.id))
    .returning();

  return {
    status: "funding_pending",
    userId: updated.userId,
    depositId: updated.id,
    provider: updated.provider,
    providerSessionId: updated.providerSessionId,
    providerTransactionId: updated.providerTransactionId,
    amount: updated.amount,
    currency: updated.currency,
    destinationWalletAddress: updated.destinationWalletAddress,
  };
}

export async function completeTopUpDepositFunding({
  depositId,
  tempoFundingTxHash,
  destinationWalletAddress,
}: {
  depositId: string;
  tempoFundingTxHash?: string;
  destinationWalletAddress?: string;
}): Promise<TopUpDepositResult> {
  return getDb().transaction(async (tx) => {
    const deposit = await tx.query.paymentDeposits.findFirst({
      where: eq(paymentDeposits.id, depositId),
    });
    if (!deposit) throw new Error("Deposit not found");

    if (deposit.status === "succeeded") {
      const current = await tx.query.userBalances.findFirst({
        where: eq(userBalances.userId, deposit.userId),
      });
      return {
        status: "already_processed" as const,
        userId: deposit.userId,
        depositId: deposit.id,
        amount: deposit.amount,
        availableBalance: current?.availableBalance ?? "0",
      };
    }

    if (deposit.status !== "funding_pending") {
      throw new Error(`Deposit cannot be credited from status ${deposit.status}`);
    }

    await tx.insert(userBalances).values({ userId: deposit.userId }).onConflictDoNothing();

    const [balance] = await tx
      .update(userBalances)
      .set({
        availableBalance: sql`${userBalances.availableBalance} + ${deposit.amount}`,
        updatedAt: new Date(),
      })
      .where(eq(userBalances.userId, deposit.userId))
      .returning();

    await tx
      .update(paymentDeposits)
      .set({
        status: "succeeded",
        tempoFundingTxHash,
        destinationWalletAddress:
          destinationWalletAddress ?? deposit.destinationWalletAddress,
        creditedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(paymentDeposits.id, deposit.id));

    await tx.insert(custodialLedger).values({
      userId: deposit.userId,
      eventType: "deposit",
      amount: deposit.amount,
      balanceAfter: balance.availableBalance,
      reference: `${deposit.provider}:${
        deposit.providerTransactionId ?? deposit.providerSessionId
      }`,
    });

    return {
      status: "credited" as const,
      userId: deposit.userId,
      depositId: deposit.id,
      amount: deposit.amount,
      availableBalance: balance.availableBalance,
    };
  });
}

export async function markTopUpDepositFundingFailed({
  depositId,
  providerTransactionId,
  destinationWalletAddress,
  reason,
  rawProviderEvent,
}: {
  depositId: string;
  providerTransactionId?: string;
  destinationWalletAddress?: string;
  reason?: string;
  rawProviderEvent?: Record<string, unknown>;
}) {
  const deposit = await getDb().query.paymentDeposits.findFirst({
    where: eq(paymentDeposits.id, depositId),
  });
  if (!deposit) throw new Error("Deposit not found");

  const [updated] = await getDb()
    .update(paymentDeposits)
    .set({
      providerTransactionId,
      destinationWalletAddress:
        destinationWalletAddress ?? deposit.destinationWalletAddress,
      status: "funding_failed",
      updatedAt: new Date(),
      metadata: {
        ...(deposit.metadata ?? {}),
        tempoFundingError: reason,
        ...(rawProviderEvent ? { rawProviderEvent } : {}),
      },
    })
    .where(eq(paymentDeposits.id, depositId))
    .returning();

  return updated;
}

export async function markTopUpDepositFailed({
  depositId,
  providerTransactionId,
  reason,
  rawProviderEvent,
}: {
  depositId?: string;
  providerTransactionId?: string;
  reason?: string;
  rawProviderEvent?: Record<string, unknown>;
}) {
  if (!depositId && !providerTransactionId) return null;
  const whereClause = depositId
    ? eq(paymentDeposits.id, depositId)
    : eq(paymentDeposits.providerTransactionId, providerTransactionId!);

  const [deposit] = await getDb()
    .update(paymentDeposits)
    .set({
      providerTransactionId,
      status: "failed",
      updatedAt: new Date(),
      metadata: {
        reason,
        ...(rawProviderEvent ? { rawProviderEvent } : {}),
      },
    })
    .where(and(whereClause, eq(paymentDeposits.status, "pending")))
    .returning();

  return deposit ?? null;
}

export async function reverseTopUpDeposit({
  depositId,
  providerTransactionId,
  reason,
  status,
  rawProviderEvent,
}: {
  depositId?: string;
  providerTransactionId: string;
  reason?: string;
  status: "refunded" | "chargeback";
  rawProviderEvent?: Record<string, unknown>;
}) {
  return getDb().transaction(async (tx) => {
    const deposit = depositId
      ? await tx.query.paymentDeposits.findFirst({
          where: eq(paymentDeposits.id, depositId),
        })
      : await tx.query.paymentDeposits.findFirst({
          where: eq(paymentDeposits.providerTransactionId, providerTransactionId),
        });
    if (!deposit || deposit.status === status) return null;
    if (deposit.status !== "succeeded") {
      await tx
        .update(paymentDeposits)
        .set({
          providerTransactionId,
          status,
          updatedAt: new Date(),
          refundedAt: status === "refunded" ? new Date() : undefined,
          chargebackAt: status === "chargeback" ? new Date() : undefined,
          metadata: {
            reason,
            ...(rawProviderEvent ? { rawProviderEvent } : {}),
          },
        })
        .where(eq(paymentDeposits.id, deposit.id));
      return null;
    }

    await tx.insert(userBalances).values({ userId: deposit.userId }).onConflictDoNothing();
    const [balance] = await tx
      .update(userBalances)
      .set({
        availableBalance: sql`${userBalances.availableBalance} - ${deposit.amount}`,
        updatedAt: new Date(),
      })
      .where(eq(userBalances.userId, deposit.userId))
      .returning();

    await tx
      .update(paymentDeposits)
      .set({
        providerTransactionId,
        status,
        updatedAt: new Date(),
        refundedAt: status === "refunded" ? new Date() : undefined,
        chargebackAt: status === "chargeback" ? new Date() : undefined,
        metadata: {
          reason,
          ...(rawProviderEvent ? { rawProviderEvent } : {}),
        },
      })
      .where(eq(paymentDeposits.id, deposit.id));

    await tx.insert(custodialLedger).values({
      userId: deposit.userId,
      eventType: "refund",
      amount: `-${deposit.amount}`,
      balanceAfter: balance.availableBalance,
      reference: `${status}:${providerTransactionId}`,
    });

    return {
      userId: deposit.userId,
      depositId: deposit.id,
      amount: deposit.amount,
      availableBalance: balance.availableBalance,
    };
  });
}

export async function attachTempoFundingToDeposit({
  depositId,
  txHash,
  destinationWalletAddress,
  error,
}: {
  depositId: string;
  txHash?: string;
  destinationWalletAddress?: string;
  error?: string;
}) {
  await getDb()
    .update(paymentDeposits)
    .set({
      tempoFundingTxHash: txHash,
      destinationWalletAddress,
      updatedAt: new Date(),
      ...(error
        ? {
            metadata: { tempoFundingError: error },
          }
        : {}),
    })
    .where(eq(paymentDeposits.id, depositId));
}

export async function withdrawCustodialBalance(userId: string, amount: string) {
  return getDb().transaction(async (tx) => {
    const [balance] = await tx
      .update(userBalances)
      .set({
        availableBalance: sql`${userBalances.availableBalance} - ${amount}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userBalances.userId, userId),
          sql`${userBalances.availableBalance} >= ${amount}`,
        ),
      )
      .returning();

    if (!balance) {
      const current = await tx.query.userBalances.findFirst({
        where: eq(userBalances.userId, userId),
      });
      return {
        status: "insufficient_funds" as const,
        availableBalance: current?.availableBalance ?? "0",
      };
    }

    await tx.insert(custodialLedger).values({
      userId,
      eventType: "withdrawal",
      amount: `-${amount}`,
      balanceAfter: balance.availableBalance,
      reference: internalReference("withdrawal"),
    });

    return {
      status: "withdrawn" as const,
      availableBalance: balance.availableBalance,
      escrowedBalance: balance.escrowedBalance,
    };
  });
}

export async function unlockWithCustodialBalance({
  userId,
  postId,
  amount,
  settlementMs,
}: {
  userId: string;
  postId: string;
  amount: string;
  settlementMs: number;
}): Promise<CustodialUnlockResult> {
  return getDb().transaction(async (tx) => {
    const existing = await tx.query.unlocks.findFirst({
      where: and(eq(unlocks.fanId, userId), eq(unlocks.postId, postId)),
    });
    if (existing) {
      return {
        status: "already_unlocked",
        txHash: existing.paymentTxHash,
      };
    }

    await tx.insert(userBalances).values({ userId }).onConflictDoNothing();

    const [balance] = await tx
      .update(userBalances)
      .set({
        availableBalance: sql`${userBalances.availableBalance} - ${amount}`,
        escrowedBalance: sql`${userBalances.escrowedBalance} + ${amount}`,
        updatedAt: new Date(),
      })
      // On-chain is the spend authority now (the route pre-checks the wallet
      // and the settlement transfer is the real guard). The ledger just mirrors.
      .where(eq(userBalances.userId, userId))
      .returning();

    if (!balance) {
      const current = await tx.query.userBalances.findFirst({
        where: eq(userBalances.userId, userId),
      });
      return {
        status: "insufficient_funds",
        balance: current?.availableBalance ?? "0",
        required: amount,
      };
    }

    const txHash = internalTxHash();

    await tx.insert(custodialLedger).values({
      userId,
      eventType: "unlock_debit",
      amount: `-${amount}`,
      balanceAfter: balance.availableBalance,
      postId,
      reference: txHash,
    });

    const [unlock] = await tx
      .insert(unlocks)
      .values({
        fanId: userId,
        postId,
        paymentTxHash: txHash,
        amountPaid: amount,
        settlementMs,
      })
      .returning();

    await tx.insert(loyaltyLedger).values({
      userId,
      amount: String(POINTS_PER_UNLOCK),
      eventType: "post_unlock",
      referenceId: unlock.id,
      txHash,
    });

    return {
      status: "unlocked",
      txHash,
      balance: balance.availableBalance,
    };
  });
}

export async function rollbackCustodialUnlock({
  userId,
  postId,
  amount,
  txHash,
}: {
  userId: string;
  postId: string;
  amount: string;
  txHash: string;
}) {
  return getDb().transaction(async (tx) => {
    const unlock = await tx.query.unlocks.findFirst({
      where: and(
        eq(unlocks.fanId, userId),
        eq(unlocks.postId, postId),
        eq(unlocks.paymentTxHash, txHash),
      ),
    });
    if (!unlock) return null;

    await tx
      .delete(loyaltyLedger)
      .where(eq(loyaltyLedger.referenceId, unlock.id));
    await tx.delete(unlocks).where(eq(unlocks.id, unlock.id));
    await tx
      .delete(custodialLedger)
      .where(eq(custodialLedger.reference, txHash));

    const [balance] = await tx
      .update(userBalances)
      .set({
        availableBalance: sql`${userBalances.availableBalance} + ${amount}`,
        escrowedBalance: sql`${userBalances.escrowedBalance} - ${amount}`,
        updatedAt: new Date(),
      })
      .where(eq(userBalances.userId, userId))
      .returning();

    return balance;
  });
}

export async function finalizeCustodialUnlockPaymentHash({
  userId,
  postId,
  internalTxHash,
  paymentTxHash,
}: {
  userId: string;
  postId: string;
  internalTxHash: string;
  paymentTxHash: string;
}) {
  await getDb().transaction(async (tx) => {
    const [unlock] = await tx
      .update(unlocks)
      .set({ paymentTxHash })
      .where(
        and(
          eq(unlocks.fanId, userId),
          eq(unlocks.postId, postId),
          eq(unlocks.paymentTxHash, internalTxHash),
        ),
      )
      .returning();

    if (!unlock) return;

    await tx
      .update(loyaltyLedger)
      .set({ txHash: paymentTxHash })
      .where(eq(loyaltyLedger.referenceId, unlock.id));
  });
}

// ── Tips (fan → creator) ──────────────────────────────────────────────────────
// A tip is an internal custodial-balance transfer: the fan is debited and the
// creator credited the full amount, atomically, in one transaction. Mirrors the
// unlock ledger pattern but the counterparty is another user's balance rather
// than the platform wallet.

export type CustodialTipResult =
  | { status: "sent"; txHash: string; balance: string }
  | { status: "insufficient_funds"; balance: string; required: string }
  | { status: "self_tip" };

export async function tipWithCustodialBalance({
  fanId,
  creatorId,
  postId,
  amount,
  message,
  settlementMs,
  paymentTxHash,
}: {
  fanId: string;
  creatorId: string;
  postId?: string | null;
  amount: string;
  message?: string | null;
  settlementMs: number;
  /** Real on-chain settlement hash; falls back to an internal ref for the row. */
  paymentTxHash?: string;
}): Promise<CustodialTipResult> {
  if (fanId === creatorId) return { status: "self_tip" };

  return getDb().transaction(async (tx) => {
    await tx.insert(userBalances).values({ userId: fanId }).onConflictDoNothing();

    // Debit the fan, guarded so a concurrent spend can't overdraw the balance.
    const [fanBalance] = await tx
      .update(userBalances)
      .set({
        availableBalance: sql`${userBalances.availableBalance} - ${amount}`,
        updatedAt: new Date(),
      })
      // On-chain is the spend authority now (the route pre-checks the wallet
      // and the settlement transfer is the real guard). The ledger just mirrors.
      .where(eq(userBalances.userId, fanId))
      .returning();

    if (!fanBalance) {
      const current = await tx.query.userBalances.findFirst({
        where: eq(userBalances.userId, fanId),
      });
      return {
        status: "insufficient_funds",
        balance: current?.availableBalance ?? "0",
        required: amount,
      };
    }

    const txHash = internalTxHash();

    await tx.insert(custodialLedger).values({
      userId: fanId,
      eventType: "tip_debit",
      amount: `-${amount}`,
      balanceAfter: fanBalance.availableBalance,
      postId: postId ?? null,
      reference: txHash,
    });

    // Credit the creator the full amount.
    await tx
      .insert(userBalances)
      .values({ userId: creatorId })
      .onConflictDoNothing();
    const [creatorBalance] = await tx
      .update(userBalances)
      .set({
        availableBalance: sql`${userBalances.availableBalance} + ${amount}`,
        updatedAt: new Date(),
      })
      .where(eq(userBalances.userId, creatorId))
      .returning();

    await tx.insert(custodialLedger).values({
      userId: creatorId,
      eventType: "tip_credit",
      amount,
      balanceAfter: creatorBalance.availableBalance,
      postId: postId ?? null,
      reference: `${txHash}:credit`,
    });

    const [tip] = await tx
      .insert(tips)
      .values({
        fanId,
        creatorId,
        postId: postId ?? null,
        amount,
        message: message ?? null,
        paymentTxHash: paymentTxHash ?? txHash,
        settlementMs,
      })
      .returning();

    // The fan earns loyalty points for the gesture, like any spend.
    await tx.insert(loyaltyLedger).values({
      userId: fanId,
      amount: String(POINTS_PER_UNLOCK),
      eventType: "tip",
      referenceId: tip.id,
      txHash,
    });

    return {
      status: "sent",
      txHash: paymentTxHash ?? txHash,
      balance: fanBalance.availableBalance,
    };
  });
}

export type MppCallReserveResult =
  | {
      status: "reserved";
      txHash: string;
      balance: string;
      escrowedBalance: string;
      amount: string;
      chargedSeconds: number;
    }
  | {
      status: "already_reserved";
      txHash: string;
      balance: string;
      escrowedBalance: string;
      amount: string;
      chargedSeconds: number;
    }
  | { status: "insufficient_funds"; balance: string; required: string }
  | { status: "self_call" };

export type MppCallSettleResult =
  | {
      status: "settled" | "already_settled";
      txHash: string;
      balance: string;
      escrowedBalance: string;
      amount: string;
    }
  | { status: "nothing_to_settle"; balance: string; escrowedBalance: string }
  | { status: "self_call" };

type DbTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

async function getReservedMppCallAmount(
  tx: DbTransaction,
  fanId: string,
  threadId: string,
  callId: string,
) {
  const reserveLike = mppCallReserveReferenceLike(threadId, callId);
  const [reserved] = await tx
    .select({
      amount: sql<string>`COALESCE(SUM((-1) * ${custodialLedger.amount}), 0)`,
    })
    .from(custodialLedger)
    .where(
      and(
        eq(custodialLedger.userId, fanId),
        eq(custodialLedger.eventType, "mpp_call_debit"),
        sql`${custodialLedger.reference} LIKE ${reserveLike}`,
      ),
    );
  return reserved?.amount ?? "0";
}

export async function getMppCallEscrowAmount({
  fanId,
  threadId,
  callId,
}: {
  fanId: string;
  threadId: string;
  callId: string;
}) {
  return getDb().transaction((tx) =>
    getReservedMppCallAmount(tx, fanId, threadId, callId),
  );
}

export async function getMppCallEscrowStatus({
  fanId,
  creatorId,
  threadId,
  callId,
}: {
  fanId: string;
  creatorId: string;
  threadId: string;
  callId: string;
}) {
  const settleRef = mppCallSettleReference(threadId, callId);
  const settledLike = `${settleRef}|%`;

  return getDb().transaction(async (tx) => {
    const existingSettlement = await tx.query.custodialLedger.findFirst({
      where: and(
        eq(custodialLedger.userId, creatorId),
        eq(custodialLedger.eventType, "mpp_call_credit"),
        sql`${custodialLedger.reference} LIKE ${settledLike}`,
      ),
    });
    if (existingSettlement) {
      const [, txHash = ""] = existingSettlement.reference.split("|");
      const balance = await tx.query.userBalances.findFirst({
        where: eq(userBalances.userId, fanId),
      });
      return {
        status: "settled" as const,
        amount: existingSettlement.amount,
        txHash,
        balance: balance?.availableBalance ?? "0",
        escrowedBalance: balance?.escrowedBalance ?? "0",
      };
    }

    return {
      status: "reserved" as const,
      amount: await getReservedMppCallAmount(tx, fanId, threadId, callId),
    };
  });
}

export async function reserveMppCallEscrow({
  fanId,
  creatorId,
  threadId,
  callId,
  amount,
  chargedSeconds,
  tick,
}: {
  fanId: string;
  creatorId: string;
  threadId: string;
  callId: string;
  amount: string;
  chargedSeconds: number;
  tick: number;
}): Promise<MppCallReserveResult> {
  if (fanId === creatorId) return { status: "self_call" };
  const reference = mppCallReserveReference(threadId, callId, tick);

  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${reference}))`);

    const existing = await tx.query.custodialLedger.findFirst({
      where: and(eq(custodialLedger.userId, fanId), eq(custodialLedger.reference, reference)),
    });
    if (existing) {
      const current = await tx.query.userBalances.findFirst({
        where: eq(userBalances.userId, fanId),
      });
      return {
        status: "already_reserved",
        txHash: reference,
        balance: existing.balanceAfter,
        escrowedBalance: current?.escrowedBalance ?? "0",
        amount,
        chargedSeconds,
      };
    }

    await tx.insert(userBalances).values({ userId: fanId }).onConflictDoNothing();

    const [fanBalance] = await tx
      .update(userBalances)
      .set({
        availableBalance: sql`${userBalances.availableBalance} - ${amount}`,
        escrowedBalance: sql`${userBalances.escrowedBalance} + ${amount}`,
        updatedAt: new Date(),
      })
      // On-chain is the spend authority now (the route pre-checks the wallet
      // and the settlement transfer is the real guard). The ledger just mirrors.
      .where(eq(userBalances.userId, fanId))
      .returning();

    if (!fanBalance) {
      const current = await tx.query.userBalances.findFirst({
        where: eq(userBalances.userId, fanId),
      });
      return {
        status: "insufficient_funds",
        balance: current?.availableBalance ?? "0",
        required: amount,
      };
    }

    await tx.insert(custodialLedger).values({
      userId: fanId,
      eventType: "mpp_call_debit",
      amount: `-${amount}`,
      balanceAfter: fanBalance.availableBalance,
      reference,
    });

    return {
      status: "reserved",
      txHash: reference,
      balance: fanBalance.availableBalance,
      escrowedBalance: fanBalance.escrowedBalance,
      amount,
      chargedSeconds,
    };
  });
}

export async function settleMppCallEscrow({
  fanId,
  creatorId,
  threadId,
  callId,
  paymentTxHash,
}: {
  fanId: string;
  creatorId: string;
  threadId: string;
  callId: string;
  paymentTxHash: string;
}): Promise<MppCallSettleResult> {
  if (fanId === creatorId) return { status: "self_call" };
  const settleRef = mppCallSettleReference(threadId, callId);
  const settledLike = `${settleRef}|%`;

  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${settleRef}))`);

    const existingSettlement = await tx.query.custodialLedger.findFirst({
      where: and(
        eq(custodialLedger.userId, creatorId),
        eq(custodialLedger.eventType, "mpp_call_credit"),
        sql`${custodialLedger.reference} LIKE ${settledLike}`,
      ),
    });
    if (existingSettlement) {
      const [, existingTxHash = paymentTxHash] = existingSettlement.reference.split("|");
      const balance = await tx.query.userBalances.findFirst({
        where: eq(userBalances.userId, fanId),
      });
      return {
        status: "already_settled",
        txHash: existingTxHash,
        balance: balance?.availableBalance ?? "0",
        escrowedBalance: balance?.escrowedBalance ?? "0",
        amount: existingSettlement.amount,
      };
    }

    const amount = await getReservedMppCallAmount(tx, fanId, threadId, callId);
    if (Number(amount) <= 0) {
      const balance = await tx.query.userBalances.findFirst({
        where: eq(userBalances.userId, fanId),
      });
      return {
        status: "nothing_to_settle",
        balance: balance?.availableBalance ?? "0",
        escrowedBalance: balance?.escrowedBalance ?? "0",
      };
    }

    const [balance] = await tx
      .update(userBalances)
      .set({
        escrowedBalance: sql`${userBalances.escrowedBalance} - ${amount}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userBalances.userId, fanId),
          sql`${userBalances.escrowedBalance} >= ${amount}`,
        ),
      )
      .returning();

    await tx.insert(userBalances).values({ userId: creatorId }).onConflictDoNothing();
    const [creatorBalance] = await tx
      .update(userBalances)
      .set({
        availableBalance: sql`${userBalances.availableBalance} + ${amount}`,
        updatedAt: new Date(),
      })
      .where(eq(userBalances.userId, creatorId))
      .returning();

    await tx.insert(custodialLedger).values({
      userId: creatorId,
      eventType: "mpp_call_credit",
      amount,
      balanceAfter: creatorBalance.availableBalance,
      reference: `${settleRef}|${paymentTxHash}`,
    });

    return {
      status: "settled",
      txHash: paymentTxHash,
      balance: balance?.availableBalance ?? "0",
      escrowedBalance: balance?.escrowedBalance ?? "0",
      amount,
    };
  });
}

export async function releaseMppCallEscrow({
  fanId,
  threadId,
  callId,
}: {
  fanId: string;
  threadId: string;
  callId: string;
}) {
  const releaseRef = `${mppCallSettleReference(threadId, callId)}:release`;
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${releaseRef}))`);
    const amount = await getReservedMppCallAmount(tx, fanId, threadId, callId);
    if (Number(amount) <= 0) return null;

    const reserveLike = mppCallReserveReferenceLike(threadId, callId);
    await tx
      .delete(custodialLedger)
      .where(
        and(
          eq(custodialLedger.userId, fanId),
          eq(custodialLedger.eventType, "mpp_call_debit"),
          sql`${custodialLedger.reference} LIKE ${reserveLike}`,
        ),
      );

    const [balance] = await tx
      .update(userBalances)
      .set({
        availableBalance: sql`${userBalances.availableBalance} + ${amount}`,
        escrowedBalance: sql`${userBalances.escrowedBalance} - ${amount}`,
        updatedAt: new Date(),
      })
      .where(eq(userBalances.userId, fanId))
      .returning();

    await tx.insert(custodialLedger).values({
      userId: fanId,
      eventType: "refund",
      amount,
      balanceAfter: balance.availableBalance,
      reference: releaseRef,
    });

    return balance;
  });
}

// ── Per-region unlocks (partial posts) ───────────────────────────────────────
// Exact mirror of the post-unlock trio above, keyed on (fanId, postRegionId).
// Every region is charged the single `posts.unlockPrice`. The ledger row still
// carries the parent postId for creator-payout attribution.

export type CustodialRegionUnlockResult =
  | { status: "already_unlocked"; txHash?: string }
  | { status: "unlocked"; txHash: string; balance: string }
  | { status: "insufficient_funds"; balance: string; required: string };

export async function unlockRegionWithCustodialBalance({
  userId,
  postId,
  postRegionId,
  amount,
  settlementMs,
}: {
  userId: string;
  postId: string;
  postRegionId: string;
  amount: string;
  settlementMs: number;
}): Promise<CustodialRegionUnlockResult> {
  return getDb().transaction(async (tx) => {
    const existing = await tx.query.regionUnlocks.findFirst({
      where: and(
        eq(regionUnlocks.fanId, userId),
        eq(regionUnlocks.postRegionId, postRegionId),
      ),
    });
    if (existing) {
      return { status: "already_unlocked", txHash: existing.paymentTxHash };
    }

    await tx.insert(userBalances).values({ userId }).onConflictDoNothing();

    const [balance] = await tx
      .update(userBalances)
      .set({
        availableBalance: sql`${userBalances.availableBalance} - ${amount}`,
        escrowedBalance: sql`${userBalances.escrowedBalance} + ${amount}`,
        updatedAt: new Date(),
      })
      // On-chain is the spend authority now (the route pre-checks the wallet
      // and the settlement transfer is the real guard). The ledger just mirrors.
      .where(eq(userBalances.userId, userId))
      .returning();

    if (!balance) {
      const current = await tx.query.userBalances.findFirst({
        where: eq(userBalances.userId, userId),
      });
      return {
        status: "insufficient_funds",
        balance: current?.availableBalance ?? "0",
        required: amount,
      };
    }

    const txHash = internalTxHash();

    await tx.insert(custodialLedger).values({
      userId,
      eventType: "unlock_debit",
      amount: `-${amount}`,
      balanceAfter: balance.availableBalance,
      postId,
      reference: txHash,
    });

    const [unlock] = await tx
      .insert(regionUnlocks)
      .values({
        fanId: userId,
        postRegionId,
        paymentTxHash: txHash,
        amountPaid: amount,
        settlementMs,
      })
      .returning();

    await tx.insert(loyaltyLedger).values({
      userId,
      amount: String(POINTS_PER_UNLOCK),
      eventType: "post_unlock",
      referenceId: unlock.id,
      txHash,
    });

    return { status: "unlocked", txHash, balance: balance.availableBalance };
  });
}

export async function rollbackCustodialRegionUnlock({
  userId,
  postRegionId,
  amount,
  txHash,
}: {
  userId: string;
  postRegionId: string;
  amount: string;
  txHash: string;
}) {
  return getDb().transaction(async (tx) => {
    const unlock = await tx.query.regionUnlocks.findFirst({
      where: and(
        eq(regionUnlocks.fanId, userId),
        eq(regionUnlocks.postRegionId, postRegionId),
        eq(regionUnlocks.paymentTxHash, txHash),
      ),
    });
    if (!unlock) return null;

    await tx.delete(loyaltyLedger).where(eq(loyaltyLedger.referenceId, unlock.id));
    await tx.delete(regionUnlocks).where(eq(regionUnlocks.id, unlock.id));
    await tx.delete(custodialLedger).where(eq(custodialLedger.reference, txHash));

    const [balance] = await tx
      .update(userBalances)
      .set({
        availableBalance: sql`${userBalances.availableBalance} + ${amount}`,
        escrowedBalance: sql`${userBalances.escrowedBalance} - ${amount}`,
        updatedAt: new Date(),
      })
      .where(eq(userBalances.userId, userId))
      .returning();

    return balance;
  });
}

export async function finalizeCustodialRegionUnlockPaymentHash({
  userId,
  postRegionId,
  internalTxHash: internalHash,
  paymentTxHash,
}: {
  userId: string;
  postRegionId: string;
  internalTxHash: string;
  paymentTxHash: string;
}) {
  await getDb().transaction(async (tx) => {
    const [unlock] = await tx
      .update(regionUnlocks)
      .set({ paymentTxHash })
      .where(
        and(
          eq(regionUnlocks.fanId, userId),
          eq(regionUnlocks.postRegionId, postRegionId),
          eq(regionUnlocks.paymentTxHash, internalHash),
        ),
      )
      .returning();

    if (!unlock) return;

    await tx
      .update(loyaltyLedger)
      .set({ txHash: paymentTxHash })
      .where(eq(loyaltyLedger.referenceId, unlock.id));
  });
}
