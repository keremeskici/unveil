// Deploy the VEIL loyalty TIP-20 token via the platform wallet, grant it the
// ISSUER role (so it can mint), and print the token address for the env var.
//
//   npm run token:create
//
// Requires a FUNDED platform wallet (PLATFORM_PRIVATE_KEY) — creation + the
// role grant pay gas in AlphaUSD. Fund the address via the Tempo faucet first.
import { getPlatformClient } from "../lib/tempo-server";

// Rename here when you want a different token name/symbol.
const TOKEN = { name: "VeilPoints", symbol: "VEIL", currency: "USD" } as const;

/** TIP-20 token id → contract address: 0x20c0 prefix + id in the low 18 bytes. */
function tokenIdToAddress(tokenId: bigint): `0x${string}` {
  return `0x20c0${tokenId.toString(16).padStart(36, "0")}`;
}

async function main() {
  const client = getPlatformClient();
  if (!client) throw new Error("PLATFORM_PRIVATE_KEY not set");
  const admin = client.account.address;

  console.log(`Creating ${TOKEN.symbol} token from ${admin} …`);
  const created = await client.token.createSync(TOKEN);
  const address = tokenIdToAddress(created.tokenId);
  console.log("✓ token created");
  console.log("  tokenId:", created.tokenId.toString());
  console.log("  address:", address);
  console.log("  tx:", created.receipt?.transactionHash);

  // Grant ISSUER_ROLE to the platform wallet so it can mint loyalty rewards.
  console.log("Granting ISSUER_ROLE to the platform wallet …");
  const grant = await client.token.grantRolesSync({
    token: address,
    to: admin,
    roles: ["issuer"],
  });
  console.log("✓ issuer role granted:", grant.receipt?.transactionHash);

  console.log("\nSet in .env.local and Vercel:");
  console.log(`  NEXT_PUBLIC_VEIL_TOKEN_ADDRESS=${address}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
