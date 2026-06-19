import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ALPHA_USD, STABLECOIN_DECIMALS, TEMPO_TESTNET } from "./constants";
import {
  completeTopUpDepositFunding,
  markTopUpDepositFundingFailed,
  normalizeMoney,
  prepareTopUpDepositFunding,
} from "./custodial";
import { getDb } from "./db";
import { custodialWallets } from "./db/schema";
import { getPlatformClient } from "./tempo-server";

const ENCRYPTION_SECRET_ENV = "CUSTODIAL_KEY_ENCRYPTION_SECRET";
const MONEY_SCALE = 8;
const USER_WALLET_FEE_RESERVE_USD = "0.10";

function getEncryptionKey() {
  const raw = process.env[ENCRYPTION_SECRET_ENV];
  if (!raw) throw new Error(`${ENCRYPTION_SECRET_ENV} is not set`);

  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(`${ENCRYPTION_SECRET_ENV} must be a base64-encoded 32-byte key`);
  }

  return key;
}

function encryptPrivateKey(privateKey: `0x${string}`) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(privateKey, "utf8"),
    cipher.final(),
  ]);

  return {
    encryptedPrivateKey: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

function decryptPrivateKey({
  encryptedPrivateKey,
  iv,
  authTag,
}: {
  encryptedPrivateKey: string;
  iv: string;
  authTag: string;
}) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedPrivateKey, "base64")),
    decipher.final(),
  ]).toString("utf8");

  if (!/^0x[0-9a-fA-F]{64}$/.test(decrypted)) {
    throw new Error("Decrypted user wallet key is malformed");
  }

  return decrypted as `0x${string}`;
}

export async function getOrCreateCustodialWallet(userId: string) {
  const db = getDb();
  const existing = await db.query.custodialWallets.findFirst({
    where: eq(custodialWallets.userId, userId),
  });
  if (existing) return existing;

  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const encrypted = encryptPrivateKey(privateKey);
  const [created] = await db
    .insert(custodialWallets)
    .values({
      userId,
      address: account.address,
      ...encrypted,
    })
    .returning();
  return created;
}

export async function ensureUserTempoWallet(userId: string) {
  const wallet = await getOrCreateCustodialWallet(userId);
  return { address: wallet.address };
}

export async function getTempoWalletAddress(userId: string) {
  const wallet = await getDb().query.custodialWallets.findFirst({
    where: eq(custodialWallets.userId, userId),
    columns: { address: true },
  });
  return wallet?.address ?? null;
}

function moneyUnits(value: string) {
  const normalized = normalizeMoney(value);
  const [whole, fraction = ""] = normalized.split(".");
  return (
    BigInt(whole) * BigInt(10) ** BigInt(MONEY_SCALE) +
    BigInt(fraction.padEnd(MONEY_SCALE, "0").slice(0, MONEY_SCALE))
  );
}

function unitsToDecimal(units: bigint, scale: number) {
  const base = BigInt(10) ** BigInt(scale);
  const whole = units / base;
  const fraction = (units % base).toString().padStart(scale, "0");
  return `${whole}.${fraction}`;
}

export function addMoney(left: string, right: string) {
  return unitsToDecimal(moneyUnits(left) + moneyUnits(right), MONEY_SCALE);
}

function stablecoinAmount(amountUsd: string) {
  const divisor = BigInt(10) ** BigInt(MONEY_SCALE - STABLECOIN_DECIMALS);
  const rounded = (moneyUnits(amountUsd) + divisor - BigInt(1)) / divisor;
  return unitsToDecimal(rounded, STABLECOIN_DECIMALS);
}

export function userWalletFeeReserveUsd() {
  return normalizeMoney(
    process.env.USER_WALLET_FEE_RESERVE_USD ?? USER_WALLET_FEE_RESERVE_USD,
  );
}

export type CustodialSettlementResult =
  | { ok: true; txHash: string; walletAddress: string }
  | { ok: false; reason: string };

export async function settleUnlockWithCustodialWallet({
  userId,
  amountUsd,
  reference,
}: {
  userId: string;
  amountUsd: string;
  reference: string;
}): Promise<CustodialSettlementResult> {
  const to = process.env.PLATFORM_WALLET_ADDRESS as `0x${string}` | undefined;
  if (!to) return { ok: false, reason: "PLATFORM_WALLET_ADDRESS is not set" };

  try {
    const wallet = await getOrCreateCustodialWallet(userId);
    const privateKey = decryptPrivateKey(wallet);
    const account = privateKeyToAccount(privateKey);
    const [{ createWalletClient, http, pad, parseUnits, stringToHex }, { Chain, tempoActions }] =
      await Promise.all([import("viem"), import("viem/tempo")]);
    const chain = Chain.moderato.extend({ feeToken: ALPHA_USD });
    const client = createWalletClient({
      account,
      chain,
      transport: http(process.env.TEMPO_RPC_URL ?? TEMPO_TESTNET.rpcHttp),
    }).extend(tempoActions());

    const memo = pad(stringToHex(`unlock:${reference.slice(0, 12)}`), {
      size: 32,
    });
    const result = await client.token.transferSync({
      to,
      amount: parseUnits(stablecoinAmount(amountUsd), STABLECOIN_DECIMALS),
      token: ALPHA_USD,
      memo,
    });
    const txHash = result.receipt?.transactionHash;
    if (!txHash) {
      return { ok: false, reason: "Tempo receipt missing transaction hash" };
    }

    return {
      ok: true,
      txHash,
      walletAddress: wallet.address,
    };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "settlement failed",
    };
  }
}

export async function settleCallWithCustodialWallet({
  userId,
  creatorAddress,
  amountUsd,
  reference,
}: {
  userId: string;
  creatorAddress: string;
  amountUsd: string;
  reference: string;
}): Promise<CustodialSettlementResult> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(creatorAddress)) {
    return { ok: false, reason: "Creator wallet address is invalid" };
  }

  try {
    const wallet = await getOrCreateCustodialWallet(userId);
    const privateKey = decryptPrivateKey(wallet);
    const account = privateKeyToAccount(privateKey);
    const [{ createWalletClient, http, pad, parseUnits, stringToHex }, { Chain, tempoActions }] =
      await Promise.all([import("viem"), import("viem/tempo")]);
    const chain = Chain.moderato.extend({ feeToken: ALPHA_USD });
    const client = createWalletClient({
      account,
      chain,
      transport: http(process.env.TEMPO_RPC_URL ?? TEMPO_TESTNET.rpcHttp),
    }).extend(tempoActions());

    const memo = pad(stringToHex(`call:${reference.slice(0, 18)}`), {
      size: 32,
    });
    const result = await client.token.transferSync({
      to: creatorAddress as `0x${string}`,
      amount: parseUnits(stablecoinAmount(amountUsd), STABLECOIN_DECIMALS),
      token: ALPHA_USD,
      memo,
    });
    const txHash = result.receipt?.transactionHash;
    if (!txHash) {
      return { ok: false, reason: "Tempo receipt missing transaction hash" };
    }

    return {
      ok: true,
      txHash,
      walletAddress: wallet.address,
    };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "call settlement failed",
    };
  }
}

export async function fundCustodialWalletFromPlatform({
  userId,
  amountUsd,
  reference,
}: {
  userId: string;
  amountUsd: string;
  reference: string;
}): Promise<CustodialSettlementResult> {
  try {
    const client = getPlatformClient();
    if (!client) return { ok: false, reason: "PLATFORM_PRIVATE_KEY not set" };

    const wallet = await getOrCreateCustodialWallet(userId);
    const { pad, parseUnits, stringToHex } = await import("viem");
    const memo = pad(stringToHex(`topup:${reference.slice(0, 12)}`), {
      size: 32,
    });
    const result = await client.token.transferSync({
      to: wallet.address as `0x${string}`,
      amount: parseUnits(stablecoinAmount(amountUsd), STABLECOIN_DECIMALS),
      token: ALPHA_USD,
      memo,
    });
    const txHash = result.receipt?.transactionHash;
    if (!txHash) {
      return { ok: false, reason: "Tempo receipt missing transaction hash" };
    }

    return {
      ok: true,
      txHash,
      walletAddress: wallet.address,
    };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "funding failed",
    };
  }
}

export async function finalizeTopUpDepositWithTempoFunding({
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
  const pending = await prepareTopUpDepositFunding({
    depositId,
    provider,
    providerTransactionId,
    providerCustomerId,
    providerPaymentMethodId,
    amount,
    currency,
    rawProviderEvent,
  });

  if (pending.status === "already_processed") return pending;

  const wallet = await ensureUserTempoWallet(pending.userId);
  const feeReserve = userWalletFeeReserveUsd();
  const fundingAmount = addMoney(pending.amount, feeReserve);
  const funding = await fundCustodialWalletFromPlatform({
    userId: pending.userId,
    amountUsd: fundingAmount,
    reference: pending.depositId,
  });

  if (!funding.ok) {
    await markTopUpDepositFundingFailed({
      depositId: pending.depositId,
      providerTransactionId,
      destinationWalletAddress: wallet.address,
      reason: funding.reason,
      rawProviderEvent,
    });
    return {
      status: "funding_failed" as const,
      userId: pending.userId,
      depositId: pending.depositId,
      amount: pending.amount,
      destinationWalletAddress: wallet.address,
      reason: funding.reason,
    };
  }

  const credited = await completeTopUpDepositFunding({
    depositId: pending.depositId,
    tempoFundingTxHash: funding.txHash,
    destinationWalletAddress: funding.walletAddress,
  });

  return {
    ...credited,
    destinationWalletAddress: funding.walletAddress,
    tempoFundingTxHash: funding.txHash,
    fundedAmount: fundingAmount,
    feeReserve,
  };
}
