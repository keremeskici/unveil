# Handover: Tempo Custodial Wallet Migration

## Current Goal

Veil is being migrated so every registered/dev user has a server-custodial Tempo wallet. Deposits fund that user wallet with AlphaUSD, then credit the local app ledger. Paid post unlocks debit the local ledger and settle on Tempo from the user wallet to the platform wallet. Free unlocks stay local.

## Important Local Instructions

- Repo: `/Users/kerem/mpp-onlyfans`
- Next.js version is unusual. Before changing Next APIs, read relevant docs in `node_modules/next/dist/docs/`.
- Do not revert unrelated dirty files. The worktree already had many pre-existing edits before this migration.
- Manual edits should use `apply_patch`.

## Implemented In This Chat

### Wallet Creation And API Surface

- Added `ensureUserTempoWallet(userId)` and `getTempoWalletAddress(userId)` in `lib/custodial-wallets.ts`.
- `getCurrentAppUser()` in `lib/app-user.ts` now ensures a Tempo custodial wallet whenever a Clerk/dev user is attached.
- `/api/user`, `/api/account`, and `/api/loyalty` now expose `tempoWalletAddress`.
- `users.walletAddress` remains legacy/profile identity. The spendable/fundable address is `custodial_wallets.address`, exposed as `tempoWalletAddress`.

### Deposit Flow

- `payment_deposit_status` enum now includes:
  - `funding_pending`
  - `funding_failed`
- `/api/account/deposit` now ensures a Tempo wallet for all providers, including `mock`, and stores `destinationWalletAddress`.
- `lib/custodial.ts` now has separate deposit funding stages:
  - `prepareTopUpDepositFunding`
  - `completeTopUpDepositFunding`
  - `markTopUpDepositFundingFailed`
- `lib/custodial-wallets.ts` has `finalizeTopUpDepositWithTempoFunding`, shared by mock deposits and CCBill webhooks.
- Provider success moves the deposit to `funding_pending`.
- Platform wallet funds the user Tempo wallet with `deposit amount + USER_WALLET_FEE_RESERVE_USD`.
- Local `user_balances.availableBalance` is credited only after Tempo funding succeeds.
- Funding failure moves the deposit to `funding_failed` and does not credit the local balance.
- `/api/account/payments` includes funding statuses, destination wallet, provider tx id, and `tempoFundingTxHash`.

### Unlock Flow

- Paid unlocks now require Tempo settlement by default.
- `/api/unlock` flow:
  - validates current app user
  - uses local balance debit/unlock creation
  - sends AlphaUSD from user custodial wallet to `PLATFORM_WALLET_ADDRESS`
  - replaces the internal unlock tx hash with the real Tempo tx hash
  - rolls back balance, unlock, ledger, and loyalty rows if settlement fails
- Free unlocks skip Tempo settlement.
- `ENABLE_USER_TEMPO_SETTLEMENT` is no longer used for normal paid unlock behavior.
- `components/useUnlock.ts` surfaces settlement failures distinctly as `Tempo settlement failed: ...`.

### Migration Script

Added `scripts/migrate-tempo-wallets.ts` and package script:

```bash
npm run tempo:wallets:migrate -- --backfill-wallets
npm run tempo:wallets:migrate -- --reset-test-ledger
```

Modes:

- `--backfill-wallets`: creates missing custodial wallets for all users.
- `--reset-test-ledger`: local/dev reset of `user_balances`, `custodial_ledger`, `payment_deposits`, unlock-derived loyalty rows, and unlock rows.
- Reset refuses production when `NODE_ENV=production` unless `ALLOW_TEST_LEDGER_RESET=true`.

Note: the CLI script intentionally does not import `lib/custodial-wallets.ts`, because that module imports `server-only` and cannot run directly under `tsx`.

### Docs And Env

- Added `docs/tempo-custodial-wallet-migration.md` with architecture, sequence diagrams, env, migration runbook, failure behavior, and manual checklist.
- Updated `.env.example` and `README.md`.
- Added local-only `.env.local` values during this chat:
  - `CUSTODIAL_KEY_ENCRYPTION_SECRET=<base64 32-byte key>`
  - `USER_WALLET_FEE_RESERVE_USD=0.10`

Do not expose the actual local secret in chat or docs.

### UI

- `app/payment-cards/page.tsx` displays the user `tempoWalletAddress`.
- Payment history can display `funding_pending` and `funding_failed`.
- Failed funding no longer visually appears as credited money.

## Database And Migration State

Added migration:

- `drizzle/0002_tempo_custodial_wallet_funding.sql`

It adds enum values:

```sql
ALTER TYPE "public"."payment_deposit_status" ADD VALUE 'funding_pending' BEFORE 'succeeded';
ALTER TYPE "public"."payment_deposit_status" ADD VALUE 'funding_failed' BEFORE 'failed';
```

`npm run db:push` was run successfully against the local configured DB.

Wallet backfill was run successfully:

```json
{
  "usersScanned": 7,
  "walletsCreated": 7,
  "balancesReset": 0,
  "custodialLedgerRowsCleared": 0,
  "paymentDepositRowsCleared": 0,
  "unlockRowsCleared": 0,
  "loyaltyRowsCleared": 0
}
```

User requested reset afterward. Test ledger reset was run successfully:

```json
{
  "usersScanned": 0,
  "walletsCreated": 0,
  "balancesReset": 4,
  "custodialLedgerRowsCleared": 3,
  "paymentDepositRowsCleared": 2,
  "unlockRowsCleared": 4,
  "loyaltyRowsCleared": 5
}
```

Tempo wallets were kept intact.

## Verification Already Run

Build:

```bash
npm run build
```

Result: passed.

Schema push:

```bash
npm run db:push
```

Result: passed.

API smoke against existing dev server on `http://localhost:3000`:

- `POST /api/dev/login`: ok
- `GET /api/user`: returned valid `tempoWalletAddress`
- `GET /api/account`: returned same valid `tempoWalletAddress` and balance fields

Non-spending pending deposit smoke was also run:

- `POST /api/account/deposit` with mock provider returned mock checkout URL.
- New pending payment row had `destinationWalletAddress`.
- The mock completion endpoint was not called in final verification, because it now intentionally performs real Tempo funding.

Temporary smoke rows were cleaned up afterward.

## Important Operational Notes

- Completing a mock deposit now spends test AlphaUSD from the platform wallet because it calls the real platform funding path.
- Paid unlocks now spend AlphaUSD from the user custodial wallet.
- Platform wallet must have enough AlphaUSD for deposits plus fee reserve.
- Each deposit funds `amount + USER_WALLET_FEE_RESERVE_USD`, but credits local balance only by `amount`.
- Stablecoin amounts are formatted to 6 decimals before `parseUnits`, while app money remains 8-decimal strings.
- Tempo memos remain 32 bytes:
  - `topup:<deposit id prefix>`
  - `unlock:<internal tx/ref prefix>`

## Remaining Manual Testnet Checklist

Run when ready to spend test funds:

1. Confirm platform wallet has AlphaUSD.
2. Sign in as dev user.
3. Confirm `/api/user` returns `tempoWalletAddress`.
4. Start a mock deposit from the payment UI.
5. Complete the mock card flow.
6. Confirm payment row goes `funding_pending` then `succeeded` and has `tempoFundingTxHash`.
7. Verify AlphaUSD arrived at the user `tempoWalletAddress`.
8. Unlock a paid post.
9. Verify AlphaUSD transferred from user wallet to `PLATFORM_WALLET_ADDRESS`.
10. Confirm local balance decreased and the post appears in collection.

## Known Caution

The worktree is dirty with many unrelated/pre-existing changes. Current `git status --short` includes migration files plus earlier auth/UI/payment work. Do not assume every modified file is part of this handover.

Notable files from this migration:

- `docs/tempo-custodial-wallet-migration.md`
- `scripts/migrate-tempo-wallets.ts`
- `lib/custodial-wallets.ts`
- `lib/custodial.ts`
- `lib/app-user.ts`
- `lib/db/schema.ts`
- `app/api/unlock/route.ts`
- `app/api/account/deposit/route.ts`
- `app/api/account/deposit/mock/route.ts`
- `app/api/ccbill/webhook/route.ts`
- `app/api/account/route.ts`
- `app/api/account/payments/route.ts`
- `app/api/user/route.ts`
- `app/payment-cards/page.tsx`
- `components/useUnlock.ts`
- `drizzle/0002_tempo_custodial_wallet_funding.sql`
- `README.md`
- `.env.example`
