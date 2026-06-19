"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CreditCard,
  Plus,
  ShoppingBag,
  X,
} from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import { EmptyState as AppEmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/Button";
import { useAppAuth } from "@/components/useAppAuth";

type Account = {
  userId: string;
  availableBalance: string;
  escrowedBalance: string;
  tempoWalletAddress: string | null;
};

type Payment = {
  id: string;
  amount: string;
  currency: string;
  status:
    | "pending"
    | "authorized"
    | "funding_pending"
    | "succeeded"
    | "funding_failed"
    | "failed"
    | "refunded"
    | "chargeback";
  provider: string;
  destinationWalletAddress: string | null;
  tempoFundingTxHash: string | null;
  createdAt: string;
  creditedAt: string | null;
};

type Tab = "cards" | "payments";

const AMOUNTS = ["10", "25", "50"] as const;
const TOP_UP_AMOUNTS = ["5", "10", "20", "50", "100"] as const;

function money(value: string | number | null | undefined) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function paymentStatusLabel(status: Payment["status"]) {
  switch (status) {
    case "funding_pending":
      return "Processing";
    case "funding_failed":
      return "Funding failed";
    case "succeeded":
      return "Completed";
    case "pending":
      return "Pending";
    case "authorized":
      return "Authorized";
    case "refunded":
      return "Refunded";
    case "chargeback":
      return "Chargeback";
    default:
      return "Failed";
  }
}

export default function PaymentCardsPage() {
  const router = useRouter();
  const { isLoaded } = useAppAuth();
  const [tab, setTab] = useState<Tab>("cards");
  const [account, setAccount] = useState<Account | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedAmount, setSelectedAmount] = useState<(typeof AMOUNTS)[number]>("25");
  const [pendingDepositId, setPendingDepositId] = useState<string | null>(null);
  const [pendingAmount, setPendingAmount] = useState<string | null>(null);
  const [mockCardAdded, setMockCardAdded] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customAmount, setCustomAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [accountRes, paymentsRes] = await Promise.all([
      fetch("/api/account", { cache: "no-store" }),
      fetch("/api/account/payments", { cache: "no-store" }),
    ]);

    if (accountRes.ok) {
      const body = (await accountRes.json()) as { account: Account };
      setAccount(body.account);
    }
    if (paymentsRes.ok) {
      const body = (await paymentsRes.json()) as { payments: Payment[] };
      setPayments(body.payments);
      setMockCardAdded(body.payments.some((payment) => payment.status === "succeeded"));
    }
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    void refresh();
  }, [isLoaded, refresh]);

  useEffect(() => {
    if (!sheetOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSheetOpen(false);
        setError(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sheetOpen]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const deposit = params.get("mockDeposit");
    const amount = params.get("amount");
    if (!deposit) return;
    setPendingDepositId(deposit);
    setPendingAmount(amount);
    setSelectedAmount((amount === "10" || amount === "25" || amount === "50" ? amount : "25"));
    setSheetOpen(true);
  }, []);

  const latest = useMemo(
    () => payments.filter((payment) => payment.status !== "failed").slice(0, 5),
    [payments],
  );

  async function startDeposit(amount: string) {
    setSubmitting(true);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch("/api/account/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok || !body.url) throw new Error(body.error ?? "Deposit failed");

      const url = new URL(body.url, window.location.origin);
      const mockDeposit = url.searchParams.get("mockDeposit");
      if (!mockDeposit) {
        window.location.assign(body.url);
        return;
      }

      setPendingDepositId(mockDeposit);
      setPendingAmount(amount);
      await completeMockDeposit(mockDeposit, amount);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deposit failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function quickTopUp(amount: string) {
    if (submitting) return;
    setTopUpAmount(amount);
    try {
      await startDeposit(amount);
    } finally {
      setTopUpAmount(null);
    }
  }

  function submitCustom() {
    const value = Number(customAmount);
    if (!Number.isFinite(value) || value < 1 || value > 500) {
      setError("Enter an amount between $1 and $500.");
      return;
    }
    const normalized = value % 1 === 0 ? String(value) : value.toFixed(2);
    setCustomOpen(false);
    setCustomAmount("");
    void quickTopUp(normalized);
  }

  async function completeMockDeposit(depositId: string, amount: string) {
    const res = await fetch("/api/account/deposit/mock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ depositId }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      result?: { status?: string; reason?: string };
    };
    if (!res.ok) throw new Error(body.error ?? "Mock deposit failed");
    if (body.result?.status === "funding_failed") {
      throw new Error(body.result.reason ?? "Deposit failed");
    }

    setMockCardAdded(true);
    setPendingDepositId(null);
    setPendingAmount(null);
    setSheetOpen(false);
    setNotice(`${money(amount)} added to your wallet.`);
    router.replace("/payment-cards");
    window.dispatchEvent(new Event("veil:balance-changed"));
    await refresh();
  }

  async function submitSheet() {
    if (pendingDepositId && pendingAmount) {
      setSubmitting(true);
      setError(null);
      try {
        await completeMockDeposit(pendingDepositId, pendingAmount);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Deposit failed");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    await startDeposit(selectedAmount);
  }

  return (
    <main className="bg-bg text-text flex min-h-dvh flex-1 flex-col">
      <header className="bg-surface/80 border-hairline pt-safe sticky top-0 z-40 border-b backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-md items-center gap-3 px-[18px] py-3.5">
          <button
            type="button"
            aria-label="Back"
            onClick={() => router.back()}
            className="text-muted hover:text-text -ml-2 flex size-[38px] items-center justify-center"
          >
            <ArrowLeft size={22} strokeWidth={2} />
          </button>
          <h1 className="flex-1 text-xl font-bold leading-none">
            Billing
          </h1>
          <button
            type="button"
            aria-label="Add billing method"
            onClick={() => setSheetOpen(true)}
            className="text-muted hover:text-text -mr-2 flex size-[38px] items-center justify-center"
          >
            <CreditCard size={24} strokeWidth={1.9} />
            <Plus size={10} strokeWidth={3} className="-ml-1 mt-4 text-primary" />
          </button>
        </div>

        <div className="border-hairline border-t">
          <div className="mx-auto flex h-[48px] w-full max-w-md overflow-hidden px-[18px]">
            <TabButton active={tab === "cards"} onClick={() => setTab("cards")}>
              BILLING
            </TabButton>
            <TabButton active={tab === "payments"} onClick={() => setTab("payments")}>
              PAYMENTS
            </TabButton>
          </div>
        </div>
      </header>

      <section className="mx-auto min-h-[calc(100dvh-104px)] w-full max-w-md flex-1 pb-28">
        {tab === "cards" && (
          <div key="cards" className="tab-panel">
            <section className="border-hairline px-[18px] py-6">
              <div className="tabular text-[28px] font-bold leading-none">
                {money(account?.availableBalance ?? "0")}
              </div>
              <div className="text-muted mt-2 text-[15px] leading-none">
                Wallet credits
              </div>
            </section>

            <section className="border-hairline border-y px-[18px] py-6">
              <h2 className="text-faint text-[13px] font-bold tracking-[0.04em]">
                ADD FUNDS
              </h2>
              <Button
                onClick={() => setSheetOpen(true)}
                className="mt-7 w-full"
              >
                <CreditCard size={18} />
                ADD BILLING METHOD
              </Button>

              <div className="mt-7">
                <h3 className="text-faint text-[12px] font-bold uppercase tracking-[0.04em]">
                  Quick top-up
                </h3>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {TOP_UP_AMOUNTS.map((amount) => {
                    const active = topUpAmount === amount;
                    return (
                      <button
                        key={amount}
                        type="button"
                        disabled={submitting}
                        onClick={() => quickTopUp(amount)}
                        className={`flex h-12 items-center justify-center rounded-md border text-[16px] font-semibold transition-colors disabled:opacity-50 ${
                          active
                            ? "border-primary bg-primary-tint text-primary"
                            : "border-hairline bg-surface-2 text-text hover:bg-surface-3"
                        }`}
                      >
                        {active ? (
                          <span
                            aria-hidden
                            className="size-[17px] rounded-full border-2 border-[color:var(--primary)]/35 border-t-[color:var(--primary)]"
                            style={{ animation: "vspin 0.7s linear infinite" }}
                          />
                        ) : (
                          money(amount)
                        )}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    aria-expanded={customOpen}
                    onClick={() => {
                      setCustomOpen((value) => !value);
                      setError(null);
                    }}
                    className={`flex h-12 items-center justify-center rounded-md border text-[15px] font-semibold transition-colors ${
                      customOpen
                        ? "border-primary bg-primary-tint text-primary"
                        : "border-hairline bg-surface-2 text-text hover:bg-surface-3"
                    }`}
                  >
                    Custom
                  </button>
                </div>

                {customOpen && (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      submitCustom();
                    }}
                    className="mt-3 flex gap-2"
                  >
                    <div className="relative flex-1">
                      <span className="text-muted pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[16px]">
                        $
                      </span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min={1}
                        max={500}
                        step="1"
                        autoFocus
                        value={customAmount}
                        onChange={(event) => setCustomAmount(event.target.value)}
                        placeholder="Amount"
                        className="bg-surface-2 border-hairline text-text h-12 w-full rounded-md border pl-8 pr-4 text-[16px] outline-none focus-visible:border-[color:var(--primary)]"
                      />
                    </div>
                    <Button
                      type="submit"
                      loading={submitting}
                      className="shrink-0 px-6"
                    >
                      ADD
                    </Button>
                  </form>
                )}

                {!sheetOpen && error && (
                  <p className="text-danger mt-3 text-[14px] font-semibold" role="alert">
                    {error}
                  </p>
                )}
              </div>
            </section>

            <section className="px-[18px] py-7">
              <div className="flex items-center justify-between">
                <h2 className="text-faint text-[13px] font-bold tracking-[0.04em]">
                  BILLING
                </h2>
                <button
                  type="button"
                  aria-label="Add billing method"
                  onClick={() => setSheetOpen(true)}
                  className="text-muted hover:text-text flex size-10 items-center justify-center"
                >
                  <CreditCard size={23} strokeWidth={1.9} />
                  <Plus size={10} strokeWidth={3} className="-ml-1 mt-4 text-primary" />
                </button>
              </div>

              {mockCardAdded ? (
                <div className="bg-surface-2 border-hairline mt-5 flex items-center gap-3 rounded-md border px-4 py-4">
                  <span className="text-primary flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-tint">
                    <CreditCard size={21} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-semibold">Mock billing card</div>
                    <div className="text-faint mt-1 text-[13px]">Ending in 4242</div>
                  </div>
                  <CheckCircle2 size={21} className="text-success" />
                </div>
              ) : (
                <div className="mt-5 flex min-h-[76px] items-center gap-3 overflow-hidden rounded-md border border-danger/35 bg-danger/10 px-4 py-3">
                  <AlertTriangle size={22} strokeWidth={2} className="shrink-0 text-danger" />
                  <p className="flex-1 text-[14.5px] leading-[1.55]">
                    Please{" "}
                    <button
                      type="button"
                      onClick={() => setSheetOpen(true)}
                      className="text-primary hover:text-primary-hover font-semibold"
                    >
                      add a billing method
                    </button>{" "}
                    to subscribe to other users or recharge your wallet.
                  </p>
                </div>
              )}
            </section>

            <section className="px-[18px] pt-2">
              <h2 className="text-faint text-[13px] font-bold tracking-[0.04em]">
                LATEST TRANSACTIONS
              </h2>
              <PaymentList payments={latest} compact />
            </section>
          </div>
        )}

        {tab === "payments" && (
          <div key="payments" className="tab-panel">
            <PaymentList payments={payments} centered />
          </div>
        )}
      </section>

      {notice && (
        <div
          aria-live="polite"
          className="bg-surface-2 border-hairline fixed inset-x-4 bottom-[96px] z-40 mx-auto max-w-md rounded-md border px-4 py-3 text-center text-[14px] font-semibold text-text shadow-card"
        >
          {notice}
        </div>
      )}

      <BottomNav />

      {sheetOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <button
            type="button"
            aria-label="Close add billing method"
            className="absolute inset-0 cursor-default bg-black/55"
            style={{ animation: "vscrim .2s ease both" }}
            onClick={() => {
              setSheetOpen(false);
              setError(null);
            }}
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-card-title"
            className="bg-surface border-hairline relative max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-card border-t px-5 pb-5 pt-5 text-text shadow-card"
            style={{ animation: "vrise .24s var(--ease-veil) both" }}
          >
            <div className="mb-4 flex items-center justify-between gap-4">
              <h2 id="add-card-title" className="text-[22px] font-bold">
                Add billing method
              </h2>
              <button
                type="button"
                aria-label="Close"
                onClick={() => {
                  setSheetOpen(false);
                  setError(null);
                }}
                className="text-muted hover:text-text flex size-10 shrink-0 items-center justify-center"
              >
                <X size={22} />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="text-faint text-[12px] font-bold uppercase tracking-[0.04em]">
                  Card number
                </span>
                <input
                  value="4242 4242 4242 4242"
                  readOnly
                  className="bg-surface-2 border-hairline text-text mt-2 h-[50px] w-full rounded-md border px-4 text-[16px] outline-none focus-visible:border-[color:var(--primary)]"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-faint text-[12px] font-bold uppercase tracking-[0.04em]">
                    Expiry
                  </span>
                  <input
                    value="04/29"
                    readOnly
                    className="bg-surface-2 border-hairline text-text mt-2 h-[50px] w-full rounded-md border px-4 text-[16px] outline-none focus-visible:border-[color:var(--primary)]"
                  />
                </label>
                <label className="block">
                  <span className="text-faint text-[12px] font-bold uppercase tracking-[0.04em]">
                    CVC
                  </span>
                  <input
                    value="123"
                    readOnly
                    className="bg-surface-2 border-hairline text-text mt-2 h-[50px] w-full rounded-md border px-4 text-[16px] outline-none focus-visible:border-[color:var(--primary)]"
                  />
                </label>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2">
              {AMOUNTS.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  onClick={() => setSelectedAmount(amount)}
                  className={`h-11 rounded-md border text-[16px] font-semibold transition-colors ${
                    selectedAmount === amount
                      ? "border-primary bg-primary-tint text-primary"
                      : "border-hairline bg-surface-2 text-text hover:bg-surface-3"
                  }`}
                >
                  {money(amount)}
                </button>
              ))}
            </div>

            {error && (
              <p className="text-danger mt-4 text-[14px] font-semibold" role="alert">
                {error}
              </p>
            )}

            <Button
              onClick={submitSheet}
              loading={submitting}
              className="mt-5 w-full"
            >
              ADD {money(pendingAmount ?? selectedAmount)}
            </Button>
          </section>
        </div>
      )}
    </main>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="relative flex h-full min-w-[126px] items-center justify-center overflow-hidden whitespace-nowrap text-[13px] font-bold tracking-[0.02em]"
      style={{ color: active ? "var(--text)" : "var(--faint)" }}
    >
      {children}
      {active && <span className="bg-primary absolute inset-x-0 bottom-0 h-1" />}
    </button>
  );
}

function PaymentList({
  payments,
  compact,
  centered,
}: {
  payments: Payment[];
  compact?: boolean;
  centered?: boolean;
}) {
  if (payments.length === 0) {
    return (
      <div
        className={
          centered
            ? "flex min-h-[520px] items-center justify-center text-center"
            : "py-14 text-center"
        }
      >
        <AppEmptyState
          icon={ShoppingBag}
          title="No payments yet"
          body="Wallet recharges will show up here."
        />
      </div>
    );
  }

  return (
    <div className={compact ? "mt-5 space-y-1" : "px-[18px] py-8"}>
      {payments.map((payment) => (
        <div
          key={payment.id}
          className="border-hairline flex min-h-[64px] items-center gap-3 border-b py-3"
        >
          <span className="bg-surface-2 text-muted flex size-10 shrink-0 items-center justify-center rounded-md">
            <ShoppingBag size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold">Wallet recharge</div>
            <div className="text-faint mt-0.5 text-[12px]">
              {shortDate(payment.creditedAt ?? payment.createdAt)} ·{" "}
              {paymentStatusLabel(payment.status)}
            </div>
          </div>
          <div className="tabular text-[15px] font-semibold text-text">
            {payment.status === "succeeded" ? "+" : ""}
            {money(payment.amount)}
          </div>
        </div>
      ))}
    </div>
  );
}
