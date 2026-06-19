"use client";

import { useEffect, useState } from "react";
import { Menu, Zap, X } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { FlexCard } from "@/components/FlexCard";
import { BottomNav } from "@/components/BottomNav";
import { SettingsDrawer } from "@/components/SettingsDrawer";
import { ConnectButton } from "@/components/ConnectButton";
import { useAppAuth, useAppUser } from "@/components/useAppAuth";

type Loyalty = {
  points: string;
  stats: { unlockCount: number; totalPaid: string; avgSettleMs: number };
  onchain: boolean;
};
type Profile = {
  username: string | null;
  avatar: string | null;
  walletAddress: string;
  displayName: string | null;
  email: string | null;
  imageUrl: string | null;
};
type CollectionItem = {
  postId: string;
  title: string;
  url: string;
  mediaType: "image" | "video";
};

export default function ProfilePage() {
  const { isSignedIn } = useAppAuth();
  const { user } = useAppUser();
  const [drawer, setDrawer] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [loyalty, setLoyalty] = useState<Loyalty | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [collection, setCollection] = useState<CollectionItem[] | null>(null);

  useEffect(() => {
    if (!isSignedIn) return;
    let live = true;
    fetch("/api/loyalty")
      .then((r) => r.json())
      .then((d) => live && setLoyalty(d))
      .catch(() => {});
    fetch("/api/user")
      .then((r) => r.json())
      .then((d) => live && setProfile(d.user))
      .catch(() => {});
    fetch("/api/collection")
      .then((r) => r.json())
      .then((d) => live && setCollection(d.items ?? []))
      .catch(() => live && setCollection([]));
    return () => {
      live = false;
    };
  }, [isSignedIn]);

  const connected = isSignedIn === true;
  const fallbackHandle = profile?.walletAddress
    ? `@${profile.walletAddress.slice(2, 8).toLowerCase()}`
    : "@you";
  const handle = profile?.username ? `@${profile.username}` : fallbackHandle;
  const displayName =
    profile?.username ?? profile?.displayName ?? user?.fullName ?? "You";
  const stats = loyalty?.stats;

  function share() {
    if (profile?.walletAddress) {
      window.open(`/api/og/flex-card?wallet=${profile.walletAddress}`, "_blank");
    }
  }

  return (
    <main className="flex min-h-dvh flex-1 flex-col">
      {/* Header bar */}
      <header className="bg-surface/80 border-hairline pt-safe sticky top-0 z-40 border-b backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-md items-center justify-between px-[18px] py-3.5">
          <span className="text-xl font-bold">Profile</span>
          <button
            type="button"
            onClick={() => setDrawer(true)}
            className="text-muted hover:text-text flex size-[38px] items-center justify-center"
            aria-label="Menu"
          >
            <Menu size={22} />
          </button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-md flex-1 px-[18px] pt-5 pb-28">
        {!connected ? (
          <div className="mt-20 flex flex-col items-center gap-5 text-center">
            <Avatar name="you" size="xl" />
            <div>
              <p className="text-text font-semibold">Sign in to see your profile</p>
              <p className="text-faint mt-1 text-sm">
                Your unlocks, Unveil balance, and flex card live here.
              </p>
            </div>
            <ConnectButton />
          </div>
        ) : (
          <>
            {/* Identity */}
            <div className="flex items-end gap-4">
              <Avatar name={handle} src={profile?.avatar} size="xl" verified />
              <div className="flex-1 pb-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xl font-bold">{displayName}</span>
                </div>
                <div className="text-faint tabular mt-0.5 text-[13.5px]">{handle}</div>
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <Button
                variant="secondary"
                className="h-[46px] flex-1 text-sm"
                onClick={() => setEditOpen(true)}
              >
                Edit profile
              </Button>
              <Button
                variant="secondary"
                className="h-[46px] flex-1 text-sm"
                onClick={share}
              >
                Share
              </Button>
            </div>

            {/* Lifetime proof strip (DESIGN_PRD §5.2) */}
            <div className="border-hairline mt-5 grid grid-cols-4 gap-px overflow-hidden rounded-md border">
              <ProofStat label="Unlocked" value={String(stats?.unlockCount ?? 0)} />
              <ProofStat label="Paid" value={`$${fmt(stats?.totalPaid ?? "0")}`} />
              <ProofStat
                label="Avg settle"
                value={stats?.avgSettleMs ? `${stats.avgSettleMs}ms` : "—"}
              />
              <ProofStat label="Gas" value="$0" accent />
            </div>

            {/* Flex card */}
            <div className="mt-6">
              <FlexCard
                handle={handle}
                balance={fmtPoints(loyalty?.points ?? "0")}
                onShare={share}
              />
              {loyalty?.onchain && (
                <div className="text-faint mt-2 flex items-center justify-center gap-1.5 text-[12px]">
                  <Zap size={12} className="text-success" />
                  Unveil minted on-chain
                </div>
              )}
            </div>

            {/* Collection — real unlocked posts */}
            <h2 className="text-text mt-7 mb-3 text-[15px] font-semibold">
              Your collection
            </h2>
            {collection === null ? (
              <p className="text-faint py-6 text-center text-sm">Loading…</p>
            ) : collection.length === 0 ? (
              <p className="text-faint py-6 text-center text-[13.5px]">
                Unlock a post to start your collection.
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {collection.map((c) =>
                  c.mediaType === "video" ? (
                    <video
                      key={c.postId}
                      src={c.url}
                      className="rounded-md object-cover"
                      style={{ aspectRatio: "1" }}
                      muted
                      playsInline
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={c.postId}
                      src={c.url}
                      alt={c.title}
                      className="rounded-md object-cover"
                      style={{ aspectRatio: "1" }}
                    />
                  ),
                )}
              </div>
            )}
          </>
        )}
      </div>

      <BottomNav />
      <SettingsDrawer open={drawer} onClose={() => setDrawer(false)} />
      {editOpen && (
        <EditProfileSheet
          current={profile?.username ?? ""}
          onClose={() => setEditOpen(false)}
          onSaved={(p) => {
            setProfile((current) => ({ ...(current ?? p), ...p } as Profile));
            setEditOpen(false);
          }}
        />
      )}
    </main>
  );
}

function EditProfileSheet({
  current,
  onClose,
  onSaved,
}: {
  current: string;
  onClose: () => void;
  onSaved: (p: Partial<Profile>) => void;
}) {
  const [name, setName] = useState(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/user", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: name }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        user?: Partial<Profile>;
        error?: string;
      };
      if (!res.ok) throw new Error(d.error ?? "Could not save");
      onSaved(d.user!);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-profile-title"
      className="fixed inset-0 z-50 flex items-end justify-center"
    >
      <button
        type="button"
        aria-label="Close edit profile"
        className="absolute inset-0 cursor-default bg-black/50"
        onClick={onClose}
      />
      <div
        className="bg-surface border-hairline relative max-h-[88dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-card border-t p-5"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 22px)" }}
      >
        <div className="mb-4 flex items-center justify-between">
          <span id="edit-profile-title" className="text-[16px] font-semibold">
            Edit profile
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted"
          >
            <X size={20} />
          </button>
        </div>
        <label htmlFor="profile-username" className="text-faint text-[12.5px]">
          Username
        </label>
        <div className="bg-surface-2 border-hairline mt-1.5 flex items-center rounded-md border px-3">
          <span className="text-faint">@</span>
          <input
            id="profile-username"
            name="username"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="yourname…"
            autoComplete="off"
            spellCheck={false}
            className="text-text placeholder:text-faint h-[46px] flex-1 bg-transparent px-1 outline-none"
          />
        </div>
        <p className="text-faint mt-2 text-[12px]">3–20 chars: a–z, 0–9, underscore.</p>
        {error && <p className="text-danger mt-2 text-[13px]">{error}</p>}
        <Button
          className="mt-4 h-[48px] w-full"
          onClick={save}
          disabled={saving || !name.trim()}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function ProofStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-surface-2 px-1 py-3 text-center">
      <div
        className="tabular text-[15px] font-bold"
        style={accent ? { color: "var(--success)" } : undefined}
      >
        {value}
      </div>
      <div className="text-faint mt-0.5 text-[11px]">{label}</div>
    </div>
  );
}

function fmt(n: string): string {
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(2) : "0.00";
}

function fmtPoints(n: string): string {
  const v = Number(n);
  return Number.isFinite(v) ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "0";
}
