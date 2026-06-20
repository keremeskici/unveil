import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  CUSTODIAL_ACCOUNT_COOKIE,
  getOrCreateCustodialAccount,
} from "@/lib/custodial";
import {
  requireCurrentAppUser,
  setAccountCookie,
  unauthorizedJson,
  UnauthorizedError,
} from "@/lib/app-user";
import { ensureUserTempoWallet } from "@/lib/custodial-wallets";
import { getSpendableOnChainUsd } from "@/lib/onchain-balance";
import { getTopUpProvider } from "@/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonWithAccountCookie(
  body: Record<string, unknown>,
  userId: string,
  init?: ResponseInit,
) {
  return setAccountCookie(NextResponse.json(body, init), userId);
}

export async function GET() {
  try {
    const user = await requireCurrentAppUser();
    const account = await getOrCreateCustodialAccount(user.id);
    const tempoWalletAddress = await getAccountWalletAddress(user.id);
    const availableBalance = await getSpendableOnChainUsd(user.id);
    return jsonWithAccountCookie(
      { account: { ...account, availableBalance, tempoWalletAddress } },
      user.id,
    );
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      const cookieStore = await cookies();
      const account = await getOrCreateCustodialAccount(
        cookieStore.get(CUSTODIAL_ACCOUNT_COOKIE)?.value,
      );
      const tempoWalletAddress = await getAccountWalletAddress(account.userId);
      const availableBalance = await getSpendableOnChainUsd(account.userId);
      return jsonWithAccountCookie(
        { account: { ...account, availableBalance, tempoWalletAddress } },
        account.userId,
      );
    }
    throw err;
  }
}

async function getAccountWalletAddress(userId: string) {
  if (getTopUpProvider().name !== "ccbill") return null;
  const tempoWallet = await ensureUserTempoWallet(userId);
  return tempoWallet.address;
}

export async function POST() {
  try {
    const user = await requireCurrentAppUser();
    return jsonWithAccountCookie(
      { error: "Use checkout to add funds" },
      user.id,
      { status: 410 },
    );
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedJson();
    throw err;
  }
}
