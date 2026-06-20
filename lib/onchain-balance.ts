import "server-only";

import { eq } from "drizzle-orm";
import { createPublicClient, http, erc20Abi } from "viem";
import { Chain } from "viem/tempo";
import { ALPHA_USD, STABLECOIN_DECIMALS, TEMPO_TESTNET } from "./constants";
import { getTempoWalletAddress, userWalletFeeReserveUsd } from "./custodial-wallets";
import { getDb } from "./db";
import { userBalances } from "./db/schema";

// On-chain is the source of truth for what a user can spend. The custodial
// wallet holds the real AlphaUSD; the `user_balances` ledger is now only a
// mirror/audit trail. "Spendable" = wallet balance minus the gas fee reserve we
// keep for it, minus anything currently escrowed in the ledger (in-flight call
// reservations that have not settled on-chain yet).

const UNITS = STABLECOIN_DECIMALS; // 6
const SCALE = BigInt(10) ** BigInt(UNITS);

function makePublicClient() {
  return createPublicClient({
    chain: Chain.moderato,
    transport: http(process.env.TEMPO_RPC_URL ?? TEMPO_TESTNET.rpcHttp),
  });
}

let cachedClient: ReturnType<typeof makePublicClient> | null = null;

function publicClient() {
  return (cachedClient ??= makePublicClient());
}

/** Parse a decimal USD string (up to 8dp, possibly "0") into 6-decimal units. */
function toUnits(value: string): bigint {
  const raw = (value ?? "0").trim();
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const frac = fraction.padEnd(UNITS, "0").slice(0, UNITS);
  const units = BigInt(whole || "0") * SCALE + BigInt(frac || "0");
  return negative ? -units : units;
}

/** Format 6-decimal units back to an 8dp USD string, matching ledger shape. */
function fromUnits(units: bigint): string {
  const negative = units < BigInt(0);
  const u = negative ? -units : units;
  const whole = u / SCALE;
  const fraction = (u % SCALE).toString().padStart(UNITS, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}00`;
}

async function readBalanceUnits(address: string): Promise<bigint> {
  return (await publicClient().readContract({
    address: ALPHA_USD,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address as `0x${string}`],
  })) as bigint;
}

/** Raw on-chain AlphaUSD balance for an address, as an 8dp USD string. */
export async function getOnChainBalanceUsd(address: string): Promise<string> {
  return fromUnits(await readBalanceUnits(address));
}

async function getLedgerEscrowUnits(userId: string): Promise<bigint> {
  const row = await getDb().query.userBalances.findFirst({
    where: eq(userBalances.userId, userId),
    columns: { escrowedBalance: true },
  });
  return toUnits(row?.escrowedBalance ?? "0");
}

/**
 * The amount a user can actually spend right now, in on-chain terms:
 * walletBalance − feeReserve − ledgerEscrow, clamped at zero. Returns "0" when
 * the user has no custodial wallet yet.
 */
export async function getSpendableOnChainUsd(userId: string): Promise<string> {
  const address = await getTempoWalletAddress(userId);
  if (!address) return fromUnits(BigInt(0));

  const [balance, escrow] = await Promise.all([
    readBalanceUnits(address),
    getLedgerEscrowUnits(userId),
  ]);
  const reserve = toUnits(userWalletFeeReserveUsd());
  const spendable = balance - reserve - escrow;
  return fromUnits(spendable > BigInt(0) ? spendable : BigInt(0));
}

export type OnChainSpendCheck =
  | { ok: true; balance: string }
  | { ok: false; balance: string };

/** Gate a spend on the live on-chain spendable balance. */
export async function checkOnChainSpendable(
  userId: string,
  amountUsd: string,
): Promise<OnChainSpendCheck> {
  const balance = await getSpendableOnChainUsd(userId);
  const ok = toUnits(balance) >= toUnits(amountUsd);
  return ok ? { ok: true, balance } : { ok: false, balance };
}
