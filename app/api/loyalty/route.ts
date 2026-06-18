import { NextRequest } from "next/server";
import { getUserByWallet, getLoyaltyBalance } from "@/lib/db/queries";

export const runtime = "nodejs";

/**
 * Loyalty (VEIL points) balance for a wallet. The off-chain ledger is the
 * source of truth for the demo; when ENABLE_ONCHAIN_REWARDS is on, the same
 * points are also minted on-chain as VEIL.
 *
 *   GET /api/loyalty?wallet=0x...
 */
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet");
  if (!wallet) {
    return Response.json({ error: "Missing wallet" }, { status: 400 });
  }

  const user = await getUserByWallet(wallet);
  const points = user ? await getLoyaltyBalance(user.id) : "0";

  return Response.json({
    wallet: wallet.toLowerCase(),
    points,
    veilToken: process.env.NEXT_PUBLIC_VEIL_TOKEN_ADDRESS || null,
    onchain: process.env.ENABLE_ONCHAIN_REWARDS === "true",
  });
}
