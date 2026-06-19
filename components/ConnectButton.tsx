"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppAuth } from "./useAppAuth";

type Account = {
  userId: string;
  availableBalance: string;
  escrowedBalance: string;
};

function formatMoney(value: string | null) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export function ConnectButton() {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAppAuth();
  const [account, setAccount] = useState<Account | null>(null);

  const refreshAccount = useCallback(async () => {
    if (!isSignedIn) {
      setAccount(null);
      return;
    }
    const res = await fetch("/api/account", { cache: "no-store" });
    if (!res.ok) return;

    const body = (await res.json()) as { account: Account };
    setAccount(body.account);
  }, [isSignedIn]);

  useEffect(() => {
    if (!isSignedIn) {
      setAccount(null);
      return;
    }
    void refreshAccount();

    const refresh = () => void refreshAccount();
    window.addEventListener("veil:balance-changed", refresh);
    return () => window.removeEventListener("veil:balance-changed", refresh);
  }, [isSignedIn, refreshAccount]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          if (isLoaded && !isSignedIn) {
            router.push("/sign-in");
            return;
          }
          router.push("/payment-cards");
        }}
        className="bg-primary text-primary-fg rounded-pill px-5 py-2.5 text-sm font-semibold transition-transform duration-[140ms] ease-[var(--ease-veil)] active:scale-[0.97]"
      >
        {isSignedIn ? (account ? formatMoney(account.availableBalance) : "Balance") : "Sign in"}
      </button>
    </div>
  );
}
