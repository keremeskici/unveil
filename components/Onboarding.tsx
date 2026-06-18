"use client";

import { useState } from "react";
import { useConnect, useConnectors } from "wagmi";
import { Lock, Eye, EyeOff } from "lucide-react";

/**
 * Login screen (matches the prototype onboarding). Email/password + social are
 * presentational for the demo; "Sign in with Passkey" triggers the real Tempo
 * passkey connector. Any path dismisses the gate and drops into the feed.
 */
export function Onboarding({ onSkip }: { onSkip: () => void }) {
  const { connect, isPending } = useConnect();
  const [connector] = useConnectors();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const canLogin = email.trim() !== "" && password !== "";

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      style={{
        background:
          "radial-gradient(120% 60% at 50% -8%, var(--tint), transparent 60%), var(--bg)",
      }}
    >
      <div className="pt-safe mx-auto flex w-full max-w-md flex-col px-7 pb-10 pt-14">
        {/* Wordmark */}
        <div className="mb-6 flex items-center gap-[11px]">
          <span
            className="size-[34px] rounded-full"
            style={{
              background:
                "conic-gradient(from 215deg,var(--primary),#7a0c24 55%,var(--primary))",
              boxShadow: "0 0 18px var(--glow)",
            }}
            aria-hidden
          />
          <span
            className="font-bold"
            style={{ fontSize: 25, letterSpacing: "0.16em", paddingLeft: "0.04em" }}
          >
            VEIL
          </span>
        </div>

        <h1 className="m-0 mb-[30px] max-w-[330px] text-[29px] font-bold leading-[1.14] tracking-[-0.02em]">
          Log in to support your favorite creators
        </h1>

        <div className="text-text mb-[13px] text-sm font-semibold">Log in</div>

        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          type="email"
          autoComplete="email"
          className="bg-surface-2 text-text placeholder:text-faint mb-3.5 h-[54px] w-full rounded-[14px] px-[18px] text-base outline-none focus:border-[color:var(--primary)]"
          style={{ border: "1px solid var(--hairline-2)" }}
        />

        <div className="relative mb-[18px]">
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            type={showPw ? "text" : "password"}
            className="bg-surface-2 text-text placeholder:text-faint h-[54px] w-full rounded-[14px] pl-[18px] pr-[52px] text-base outline-none focus:border-[color:var(--primary)]"
            style={{ border: "1px solid var(--hairline-2)" }}
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            aria-label={showPw ? "Hide password" : "Show password"}
            className="text-faint absolute right-0 top-0 flex h-[54px] w-[50px] items-center justify-center"
          >
            {showPw ? <EyeOff size={22} strokeWidth={1.9} /> : <Eye size={22} strokeWidth={1.9} />}
          </button>
        </div>

        {/* Primary form action — demo enters the feed once both fields are filled */}
        <button
          onClick={onSkip}
          disabled={!canLogin}
          className="h-[54px] w-full rounded-pill text-[15px] font-bold tracking-[0.04em] transition-transform duration-[140ms] ease-[var(--ease-veil)] active:scale-[0.985]"
          style={
            canLogin
              ? { background: "var(--primary)", color: "#fff", boxShadow: "0 8px 28px var(--glow)" }
              : { background: "var(--surface-3)", color: "var(--faint)" }
          }
        >
          LOG IN
        </button>

        <p className="text-faint mt-3.5 text-[12.5px] leading-[1.55]">
          By logging in and using Veil, you agree to our{" "}
          <span className="text-primary">Terms of Service</span> and{" "}
          <span className="text-primary">Privacy Policy</span>, and confirm that you
          are at least 18 years old.
        </p>

        <div
          className="text-primary flex items-center justify-center gap-3 text-sm font-semibold"
          style={{ margin: "26px 0 22px" }}
        >
          <span className="cursor-pointer">Forgot password?</span>
          <span className="text-faint">·</span>
          <span className="cursor-pointer">Sign up for Veil</span>
        </div>

        {/* Social / passkey */}
        <div className="flex flex-col gap-[13px]">
          {/* Passkey — solid red, the REAL Tempo connect */}
          <button
            onClick={() => connect({ connector })}
            disabled={isPending}
            className="text-primary-fg relative flex h-[52px] w-full items-center justify-center rounded-pill text-sm font-bold tracking-[0.04em] transition-transform duration-[140ms] ease-[var(--ease-veil)] active:scale-[0.985] disabled:opacity-60"
            style={{ background: "var(--primary)", boxShadow: "0 6px 22px var(--glow)" }}
          >
            <Lock size={19} className="absolute left-[22px]" />
            {isPending ? "OPENING…" : "SIGN IN WITH PASSKEY"}
          </button>

          {/* X — red stroke outline */}
          <button
            onClick={onSkip}
            className="text-text relative flex h-[52px] w-full items-center justify-center rounded-pill text-sm font-bold tracking-[0.04em] transition-transform duration-[140ms] ease-[var(--ease-veil)] active:scale-[0.985]"
            style={{ border: "1px solid var(--primary)", background: "transparent" }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="absolute left-[23px]"
              aria-hidden
            >
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            SIGN IN WITH X
          </button>

          {/* Google — red stroke outline, multicolor G */}
          <button
            onClick={onSkip}
            className="text-text relative flex h-[52px] w-full items-center justify-center rounded-pill text-sm font-bold tracking-[0.04em] transition-transform duration-[140ms] ease-[var(--ease-veil)] active:scale-[0.985]"
            style={{ border: "1px solid var(--primary)", background: "transparent" }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" className="absolute left-[22px]" aria-hidden>
              <path fill="#4285F4" d="M21.6 12.2c0-.6-.1-1.3-.2-1.9H12v3.6h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.2Z" />
              <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 .9-3.4.9-2.6 0-4.8-1.7-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z" />
              <path fill="#FBBC05" d="M6.4 13.9a6 6 0 0 1 0-3.8V7.5H3.1a10 10 0 0 0 0 9l3.3-2.6Z" />
              <path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 3.1 7.5l3.3 2.6C7.2 7.6 9.4 5.9 12 5.9Z" />
            </svg>
            SIGN IN WITH GOOGLE
          </button>
        </div>
      </div>
    </div>
  );
}
