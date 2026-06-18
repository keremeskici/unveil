import {
  createWalletClient,
  http,
  parseUnits,
  pad,
  stringToHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Chain, tempoActions } from "viem/tempo";
import { ALPHA_USD, STABLECOIN_DECIMALS, TEMPO_TESTNET } from "./constants";

/**
 * Verify a Tempo payment receipt server-side.
 *
 * Hackathon level: confirm the tx exists and its receipt status is success
 * (0x1). Production hardening (a TODO): decode the TIP-20 Transfer log to
 * assert the recipient == platform wallet and value >= unlock price.
 */
export async function verifyTempoPayment(
  txHash: string,
  _expectedAmount: string,
  _fromAddress: string,
): Promise<boolean> {
  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) return false;

  try {
    const res = await fetch(TEMPO_TESTNET.rpcHttp, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getTransactionReceipt",
        params: [txHash],
      }),
      // Receipts settle in ~500ms; don't hang the request forever.
      signal: AbortSignal.timeout(8000),
    });
    const json = (await res.json()) as {
      result?: { status?: string } | null;
    };
    const result = json.result;
    if (!result) return false;
    return result.status === "0x1";
  } catch {
    return false;
  }
}

/**
 * Server-side wallet client for the platform account. Pays its own gas in
 * AlphaUSD (the chain's fee token). Returns null if no platform key is set.
 */
export function getPlatformClient() {
  const pk = process.env.PLATFORM_PRIVATE_KEY as `0x${string}` | undefined;
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
