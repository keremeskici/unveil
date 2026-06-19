/**
 * Network & protocol constants for Unveil on Tempo (Moderato testnet).
 * See .claude/.md/IMPLEMENTATION.md §2.
 */

export const TEMPO_TESTNET = {
  name: "Tempo Testnet (Moderato)",
  chainId: 42431,
  rpcHttp: "https://rpc.moderato.tempo.xyz",
  rpcWs: "wss://rpc.moderato.tempo.xyz",
  explorer: "https://explore.testnet.tempo.xyz",
  faucet: "https://docs.tempo.xyz/quickstart/faucet",
  feeSponsor: "https://sponsor.moderato.tempo.xyz",
  tip20Factory: "0x20Fc000000000000000000000000000000000000",
} as const;

/**
 * Testnet stablecoins (all 6 decimals). AlphaUSD is the default unlock currency.
 */
export const STABLECOINS = {
  AlphaUSD: "0x20c0000000000000000000000000000000000001",
} as const;

export const ALPHA_USD = STABLECOINS.AlphaUSD;

/** All TIP-20 stablecoins use 6 decimals. */
export const STABLECOIN_DECIMALS = 6;

/** Loyalty points awarded per post unlock. */
export const POINTS_PER_UNLOCK = 10;

/** Platform revenue cut (the rest goes to the creator). */
export const PLATFORM_CUT = 0.1;
export const CREATOR_CUT = 1 - PLATFORM_CUT;

/** Default access-key spending cap, in 6-decimal units ($25). */
export const DEFAULT_SPEND_CAP = "25000000";

/**
 * Format a stored price/amount string (e.g. "0.25000000") for display:
 * trims trailing zeros, keeps at least 2 decimals. The raw string is what
 * gets passed to parseUnits — only the *display* is formatted.
 */
export function formatUsd(amount: string | number): string {
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) return "0.00";
  const trimmed = n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  const [int, frac = ""] = trimmed.split(".");
  const padded = frac.length < 2 ? (frac + "00").slice(0, 2) : frac;
  return `${int}.${padded}`;
}

export const APP_NAME = "Unveil";

// Absolute base URL for share links / OG cards / webhooks. Resilient to the
// common misconfigurations: an EMPTY-STRING env var (not nullish, so `?? ` keeps
// it) and a scheme-less host. Falls back to Vercel's injected deployment host
// (server-side only — these are not NEXT_PUBLIC) before localhost.
function resolveAppUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return /^https?:\/\//i.test(explicit) ? explicit : `https://${explicit}`;
  const host =
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || process.env.VERCEL_URL?.trim();
  if (host) return `https://${host}`;
  return "http://localhost:3000";
}

export const APP_URL = resolveAppUrl();
