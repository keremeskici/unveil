import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { getUserByWallet, getLoyaltyBalance, getUserStats } from "@/lib/db/queries";

export const runtime = "nodejs";

// Palette (literal — Satori does not resolve CSS variables).
const BG = "#121012";
const WINE = "#c2143b";
const TEXT = "#f5f2f3";
const MUTED = "#a8a0a4";
const FAINT = "#6e666b";
const GOLD = "#e8b339";

/**
 * Flex Card share image (DESIGN_PRD §5.3 / IMPLEMENTATION §11.2). A
 * Robinhood/Binance-PnL-style card for share-to-X/Telegram link previews.
 *
 *   GET /api/og/flex-card?wallet=0x...
 *   GET /api/og/flex-card?handle=@you&balance=1240&tier=Insider&rank=%23214&streak=7&degen=820
 *
 * If `wallet` is given, the balance + handle come from the live loyalty ledger.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;

  let handle = q.get("handle") ?? "@you";
  let balance = q.get("balance") ?? "0";
  const tier = q.get("tier") ?? "Insider";
  const rank = q.get("rank") ?? "#214";
  const streak = q.get("streak") ?? "7";
  const degen = q.get("degen") ?? "820";

  const wallet = q.get("wallet");
  if (wallet && /^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    try {
      const user = await getUserByWallet(wallet);
      if (user) {
        const points = await getLoyaltyBalance(user.id);
        balance = Number(points).toLocaleString("en-US", { maximumFractionDigits: 0 });
        await getUserStats(user.id); // touch (kept for parity / future stats)
      }
      handle = `@${wallet.slice(2, 8).toLowerCase()}`;
    } catch {
      /* fall back to params/defaults */
    }
  }

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          padding: 72,
          color: TEXT,
          background: BG,
          fontFamily: "sans-serif",
          position: "relative",
        }}
      >
        {/* wine glow */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(58% 80% at 90% 0%, rgba(194,20,59,0.75), rgba(194,20,59,0.12) 42%, rgba(194,20,59,0) 62%)",
          }}
        />

        {/* top row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                background: WINE,
                marginRight: 16,
              }}
            />
            <div style={{ fontSize: 36, fontWeight: 700 }}>UNVEIL</div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "12px 26px",
              borderRadius: 999,
              background: "rgba(232,179,57,0.14)",
              border: `1px solid rgba(232,179,57,0.4)`,
              color: GOLD,
              fontSize: 26,
              fontWeight: 600,
            }}
          >
            <div style={{ width: 12, height: 12, borderRadius: 6, background: GOLD, marginRight: 12 }} />
            {tier}
          </div>
        </div>

        {/* balance */}
        <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
          <div style={{ fontSize: 26, color: MUTED, letterSpacing: 6, textTransform: "uppercase" }}>
            Unveil balance
          </div>
          <div style={{ fontSize: 150, fontWeight: 800, lineHeight: 1, marginTop: 8 }}>
            {balance}
          </div>
        </div>

        {/* stats */}
        <div style={{ display: "flex", marginTop: 44 }}>
          <Stat label="Rank" value={rank} last={false} />
          <Stat label="Streak" value={`${streak}d`} last={false} />
          <Stat label="Degen" value={degen} last />
        </div>

        {/* handle */}
        <div style={{ display: "flex", marginTop: 30, color: FAINT, fontSize: 26 }}>{handle}</div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}

function Stat({ label, value, last }: { label: string; value: string; last: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        padding: "20px 24px",
        marginRight: last ? 0 : 16,
        borderRadius: 18,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <div style={{ fontSize: 38, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 22, color: FAINT, marginTop: 6 }}>{label}</div>
    </div>
  );
}
