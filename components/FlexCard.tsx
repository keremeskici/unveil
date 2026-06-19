"use client";

import { Share2, Flame, Trophy } from "lucide-react";

/**
 * Robinhood/Binance-PnL-style shareable card — the viral wow (DESIGN_PRD §5.3).
 * The one place gold + gradient + glow combine. Mirrored server-side via
 * @vercel/og for share-to-X; this is the in-app preview.
 */
export function FlexCard({
  handle = "@you",
  balance,
  tier = "Insider",
  rank = "#214",
  streak = 7,
  degenScore = 820,
  onShare,
}: {
  handle?: string;
  balance: string;
  tier?: string;
  rank?: string;
  streak?: number;
  degenScore?: number;
  onShare?: () => void;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-card p-5"
      style={{
        background:
          "radial-gradient(120% 100% at 85% 0%, rgba(194,20,59,.55), transparent 52%), linear-gradient(160deg,#1b0c12,#121012 60%)",
        boxShadow: "0 16px 48px rgba(0,0,0,.5), 0 0 0 1px var(--hairline)",
      }}
    >
      {/* glow blob */}
      <div
        className="pointer-events-none absolute -top-16 -right-10 size-44 rounded-full"
        style={{ background: "var(--primary-glow)", filter: "blur(40px)" }}
        aria-hidden
      />

      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="size-4 rounded-full"
            style={{
              background:
                "conic-gradient(from 215deg,var(--primary),#7a0c24 55%,var(--primary))",
            }}
          />
          <span className="text-[13px] font-bold">UNVEIL</span>
        </div>
        <span
          className="text-gold flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[11px] font-semibold"
          style={{ background: "rgba(232,179,57,.12)", border: "1px solid rgba(232,179,57,.3)" }}
        >
          <Trophy size={13} /> {tier}
        </span>
      </div>

      <div className="relative mt-7">
        <div className="text-faint text-[12px] tracking-[0.14em] uppercase">
          Unveil balance
        </div>
        <div className="tabular text-text mt-1 text-[40px] leading-none font-bold">
          {balance}
        </div>
      </div>

      <div className="relative mt-6 flex items-stretch gap-2">
        <Stat label="Rank" value={rank} />
        <Stat
          label="Streak"
          value={
            <span className="flex items-center gap-1">
              <Flame size={15} className="text-primary" />
              {streak}d
            </span>
          }
        />
        <Stat label="Degen" value={String(degenScore)} />
      </div>

      <button
        type="button"
        onClick={onShare}
        className="bg-primary text-primary-fg relative mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-pill text-[15px] font-semibold transition-transform duration-[140ms] ease-[var(--ease-veil)] active:scale-[0.98]"
        style={{ boxShadow: "0 8px 26px var(--primary-glow)" }}
      >
        <Share2 size={18} />
        Share your flex
      </button>

      <div className="text-faint relative mt-3 text-center text-[12px]">{handle}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      className="flex-1 rounded-md px-3 py-2.5 text-center"
      style={{ background: "rgba(255,255,255,.04)", border: "1px solid var(--hairline)" }}
    >
      <div className="tabular text-text text-[16px] font-bold">{value}</div>
      <div className="text-faint mt-0.5 text-[11px]">{label}</div>
    </div>
  );
}
