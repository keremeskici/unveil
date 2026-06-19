import {
  createWalletClient,
  createPublicClient,
  http,
  parseUnits,
  parseEventLogs,
  erc20Abi,
  pad,
  stringToHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Chain, tempoActions } from "viem/tempo";
import { ALPHA_USD, STABLECOIN_DECIMALS, TEMPO_TESTNET } from "./constants";

export type PaymentCheck = { ok: true } | { ok: false; reason: string };

const eq = (a?: string, b?: string) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

function normalizePrivateKey(raw: string | undefined) {
  if (!raw) return null;

  const unquoted = raw.trim().replace(/^['"]|['"]$/g, "");
  const withPrefix = unquoted.startsWith("0x") ? unquoted : `0x${unquoted}`;

  if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) {
    throw new Error(
      "PLATFORM_PRIVATE_KEY must be a 32-byte hex private key, with or without 0x",
    );
  }

  return withPrefix as `0x${string}`;
}

/**
 * Verify, server-side, that `txHash` is a real on-chain payment for this unlock:
 *  1. the receipt exists and succeeded;
 *  2. it contains a TIP-20 `Transfer` of the AlphaUSD token (`ALPHA_USD`)
 *  3. whose recipient is the platform wallet,
 *  4. for at least the post's price, and
 *  5. sent FROM the fan's wallet.
 *
 * A single Tempo transfer emits multiple logs (the real Transfer, a memo event,
 * and a fee Transfer to the fee-manager `0xfeec…`), so we match the specific
 * Transfer by `address == token` AND `to == platform`, never just the first log.
 */
export async function verifyTempoPayment(
  txHash: string,
  expectedAmountUsd: string,
  fromAddress: string,
): Promise<PaymentCheck> {
  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return { ok: false, reason: "bad tx hash" };
  }
  const platform = process.env.PLATFORM_WALLET_ADDRESS;
  if (!platform) return { ok: false, reason: "platform wallet not configured" };

  const client = createPublicClient({
    chain: Chain.moderato,
    transport: http(process.env.TEMPO_RPC_URL ?? TEMPO_TESTNET.rpcHttp),
  });

  let receipt;
  try {
    receipt = await client.getTransactionReceipt({
      hash: txHash as `0x${string}`,
    });
  } catch {
    return { ok: false, reason: "receipt not found" };
  }
  if (receipt.status !== "success") {
    return { ok: false, reason: "tx not successful" };
  }

  // Decode every ERC-20/TIP-20 Transfer in the receipt.
  const transfers = parseEventLogs({
    abi: erc20Abi,
    eventName: "Transfer",
    logs: receipt.logs,
  });

  const required = parseUnits(expectedAmountUsd, STABLECOIN_DECIMALS);

  // The payment: AlphaUSD Transfer → platform wallet, for >= price.
  const payment = transfers.find(
    (t) =>
      eq(t.address, ALPHA_USD) &&
      eq(t.args.to, platform) &&
      t.args.value >= required,
  );
  if (!payment) {
    return { ok: false, reason: "no matching payment transfer" };
  }

  // The payment must originate from the fan claiming the unlock.
  if (!eq(payment.args.from, fromAddress)) {
    return { ok: false, reason: "payment sender mismatch" };
  }

  return { ok: true };
}

/**
 * Server-side wallet client for the platform account. Pays its own gas in
 * AlphaUSD (the chain's fee token). Returns null if no platform key is set.
 */
export function getPlatformClient() {
  const pk = normalizePrivateKey(process.env.PLATFORM_PRIVATE_KEY);
  if (!pk) return null;
  const account = privateKeyToAccount(pk);
  const chain = Chain.moderato.extend({ feeToken: ALPHA_USD });
  return createWalletClient({
    account,
    chain,
    transport: http(process.env.TEMPO_RPC_URL ?? TEMPO_TESTNET.rpcHttp),
  }).extend(tempoActions());
}

export type ChainOpResult =
  | { ok: true; txHash?: string }
  | { ok: false; reason: string };

/**
 * Pay the creator their share of an unlock (server-side TIP-20 transfer).
 * Requires the platform wallet to be funded with AlphaUSD (gas + payout).
 */
export async function sendCreatorPayout(
  creatorAddress: string,
  amountUsd: number,
  originalTxHash: string,
): Promise<ChainOpResult> {
  const client = getPlatformClient();
  if (!client) return { ok: false, reason: "PLATFORM_PRIVATE_KEY not set" };
  if (amountUsd <= 0) return { ok: false, reason: "non-positive payout" };

  try {
    const memo = pad(stringToHex(`payout:${originalTxHash.slice(0, 10)}`), {
      size: 32,
    });
    const result = await client.token.transferSync({
      to: creatorAddress as `0x${string}`,
      amount: parseUnits(amountUsd.toFixed(STABLECOIN_DECIMALS), STABLECOIN_DECIMALS),
      token: ALPHA_USD,
      memo,
    });
    return { ok: true, txHash: result.receipt?.transactionHash };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "payout failed",
    };
  }
}

/**
 * Mint loyalty (VEIL) tokens to a fan on-chain. Requires the VEIL token to be
 * deployed (NEXT_PUBLIC_VEIL_TOKEN_ADDRESS) and a funded platform wallet.
 */
export async function mintLoyalty(
  toAddress: string,
  points: number,
): Promise<ChainOpResult> {
  const tokenAddr = process.env.NEXT_PUBLIC_VEIL_TOKEN_ADDRESS as
    | `0x${string}`
    | undefined;
  if (!tokenAddr) return { ok: false, reason: "VEIL token not deployed" };
  const client = getPlatformClient();
  if (!client) return { ok: false, reason: "PLATFORM_PRIVATE_KEY not set" };

  try {
    const result = await client.token.mintSync({
      to: toAddress as `0x${string}`,
      amount: parseUnits(String(points), STABLECOIN_DECIMALS),
      token: tokenAddr,
    });
    return { ok: true, txHash: result.receipt?.transactionHash };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "mint failed",
    };
  }
}
