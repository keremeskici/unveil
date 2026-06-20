import { eq } from "drizzle-orm";
import { createPublicClient, http, erc20Abi, formatUnits, parseUnits } from "viem";
import { Chain } from "viem/tempo";
import { getDb } from "../lib/db";
import { getPgPool } from "../lib/db/pool";
import { custodialWallets, userBalances, users } from "../lib/db/schema";
import { ALPHA_USD, STABLECOIN_DECIMALS, TEMPO_TESTNET } from "../lib/constants";

// Mirrors lib/onchain-balance.ts getSpendableOnChainUsd, inlined so this script
// doesn't import the server-only module.
const EMAIL = process.argv[2] ?? "kerem.eskici@yahoo.com";
const RESERVE = process.env.USER_WALLET_FEE_RESERVE_USD ?? "0.10";
const pub = createPublicClient({
  chain: Chain.moderato,
  transport: http(process.env.TEMPO_RPC_URL ?? TEMPO_TESTNET.rpcHttp),
});

function toUnits(value: string): bigint {
  const [whole = "0", frac = ""] = (value ?? "0").trim().split(".");
  return BigInt(whole || "0") * 1_000_000n + BigInt(frac.padEnd(6, "0").slice(0, 6) || "0");
}

async function main() {
  const db = getDb();
  const user = await db.query.users.findFirst({ where: eq(users.email, EMAIL) });
  if (!user) return console.log(`No user with email ${EMAIL}`);
  const bal = await db.query.userBalances.findFirst({ where: eq(userBalances.userId, user.id) });
  const wallet = await db.query.custodialWallets.findFirst({
    where: eq(custodialWallets.userId, user.id),
  });
  if (!wallet) return console.log("no custodial wallet");

  const raw = (await pub.readContract({
    address: ALPHA_USD,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [wallet.address as `0x${string}`],
  })) as bigint;
  const escrow = toUnits(bal?.escrowedBalance ?? "0");
  const reserve = parseUnits(RESERVE, STABLECOIN_DECIMALS);
  const spendable = raw - reserve - escrow;

  console.log(`user: ${EMAIL}`);
  console.log(`ledger available: ${bal?.availableBalance ?? "-"}  escrow: ${bal?.escrowedBalance ?? "-"}`);
  console.log(`wallet ${wallet.address}`);
  console.log(`on-chain raw:   ${formatUnits(raw, STABLECOIN_DECIMALS)}`);
  console.log(`- fee reserve:  ${RESERVE}`);
  console.log(`- escrow:       ${formatUnits(escrow, STABLECOIN_DECIMALS)}`);
  console.log(`= SPENDABLE:    ${formatUnits(spendable > 0n ? spendable : 0n, STABLECOIN_DECIMALS)}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await getPgPool().end();
    } catch {
      /* never opened */
    }
  });
