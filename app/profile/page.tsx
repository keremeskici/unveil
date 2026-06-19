"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { Camera, Menu, LayoutGrid, Bookmark, Lock, Play, X, Zap } from "lucide-react";
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
type Stats = {
  posts: number;
  locked: number;
  likes: number;
  fans: number;
  following: number;
};
type PostTile = {
  id: string;
  title: string;
  unlockPrice: string;
  priceLabel: string;
  mediaType: "image" | "video";
  previewUrl: string | null;
};
type CollectionItem = {
  postId: string;
  title: string;
  url: string;
  mediaType: "image" | "video";
};

type Tab = "posts" | "collection";

export default function ProfilePage() {
  const { isSignedIn } = useAppAuth();
  const { user } = useAppUser();
  const [drawer, setDrawer] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editClosing, setEditClosing] = useState(false);
  const [loyalty, setLoyalty] = useState<Loyalty | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [posts, setPosts] = useState<PostTile[] | null>(null);
  const [collection, setCollection] = useState<CollectionItem[] | null>(null);
  const [tab, setTab] = useState<Tab>("posts");

  const connected = isSignedIn === true;

  useEffect(() => {
    if (!connected) return;
    let live = true;
    fetch("/api/user")
      .then((r) => r.json())
      .then((d) => live && setProfile(d.user))
      .catch(() => {});
    fetch("/api/loyalty")
      .then((r) => r.json())
      .then((d) => live && setLoyalty(d))
      .catch(() => {});
    fetch("/api/profile/stats")
      .then((r) => r.json())
      .then((d) => live && setStats(d))
      .catch(() => {});
    fetch("/api/posts")
      .then((r) => r.json())
      .then((d) => live && setPosts(d.posts ?? []))
      .catch(() => live && setPosts([]));
    return () => {
      live = false;
    };
  }, [connected]);

  // Collection is only needed once the user opens that tab.
  useEffect(() => {
    if (!connected || tab !== "collection" || collection !== null) return;
    let live = true;
    fetch("/api/collection")
      .then((r) => r.json())
      .then((d) => live && setCollection(d.items ?? []))
      .catch(() => live && setCollection([]));
    return () => {
      live = false;
    };
  }, [connected, tab, collection]);

  const fallbackHandle = profile?.walletAddress
    ? `@${profile.walletAddress.slice(2, 8).toLowerCase()}`
    : "@you";
  const handle = profile?.username ? `@${profile.username}` : fallbackHandle;
  const displayName =
    profile?.username ?? profile?.displayName ?? user?.fullName ?? "You";
  const loyaltyStats = loyalty?.stats;

  function share() {
    if (profile?.walletAddress) {
      window.open(`/api/og/flex-card?wallet=${profile.walletAddress}`, "_blank");
    }
  }

  function openEdit() {
    setEditOpen(true);
    setEditClosing(false);
  }

  function closeEdit() {
    setEditClosing(true);
    window.setTimeout(() => {
      setEditOpen(false);
      setEditClosing(false);
    }, 220);
  }

  return (
    <main className="flex min-h-dvh flex-1 flex-col">
      {/* Header bar */}
      <header className="bg-surface/80 border-hairline pt-safe sticky top-0 z-40 border-b backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-md items-center justify-between px-[18px] py-3.5">
          <h1 className="text-xl font-bold">Profile</h1>
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

      <div className="mx-auto w-full max-w-md flex-1 pb-28">
        {!connected ? (
          <div className="mt-20 flex flex-col items-center gap-5 px-8 text-center">
            <Avatar name="you" size="xl" />
            <div>
              <p className="text-text font-semibold">Sign in to see your profile</p>
              <p className="text-faint mt-1 text-sm">
                Your posts, fans, and unlocked collection live here.
              </p>
            </div>
            <ConnectButton />
          </div>
        ) : (
          <>
            <div className="px-[18px] pt-5">
              {/* Identity */}
              <div className="flex items-end gap-4">
                <Avatar
                  name={handle}
                  src={profile?.avatar ?? profile?.imageUrl}
                  size="xl"
                  verified
                />
                <div className="flex-1 pb-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xl font-bold">{displayName}</span>
                  </div>
                  <div className="text-faint tabular mt-0.5 text-[13.5px]">
                    {handle}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="mt-4 flex gap-2">
                <Button
                  variant="secondary"
                  className="h-[46px] flex-1 text-sm"
                  onClick={openEdit}
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

              {/* Headline stats */}
              <div className="border-hairline mt-5 flex border-y py-4">
                <StatCol label="Posts" value={fmtCompact(stats?.posts)} />
                <StatCol
                  label="Followers"
                  value={fmtCompact(stats?.fans)}
                  href="/connections?tab=followers"
                  divider
                />
                <StatCol
                  label="Following"
                  value={fmtCompact(stats?.following)}
                  href="/connections?tab=following"
                  divider
                />
              </div>

              {/* Lifetime proof strip (DESIGN_PRD §5.2) */}
              <div className="border-hairline mt-5 grid grid-cols-4 gap-px overflow-hidden rounded-md border">
                <ProofStat label="Unlocked" value={String(loyaltyStats?.unlockCount ?? 0)} />
                <ProofStat label="Paid" value={`$${fmt(loyaltyStats?.totalPaid ?? "0")}`} />
                <ProofStat
                  label="Avg settle"
                  value={loyaltyStats?.avgSettleMs ? `${loyaltyStats.avgSettleMs}ms` : "—"}
                />
                <ProofStat label="Gas" value="$0" accent />
              </div>

              <div className="mt-5">
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

              {/* Tabs */}
              <div className="border-hairline mt-5 flex items-center border-b">
                <TabButton
                  icon={LayoutGrid}
                  label="Posts"
                  active={tab === "posts"}
                  onClick={() => setTab("posts")}
                />
                <TabButton
                  icon={Bookmark}
                  label="Collection"
                  active={tab === "collection"}
                  onClick={() => setTab("collection")}
                />
                <div className="flex-1" />
                <span className="tabular text-faint pb-2.5 pr-1 text-[12px]">
                  {tab === "posts"
                    ? `${stats?.posts ?? 0} · ${stats?.locked ?? 0} locked`
                    : `${collection?.length ?? 0} unlocked`}
                </span>
              </div>
            </div>

            {/* Grid */}
            <div key={tab} className="tab-panel mt-0.5">
              {tab === "posts" ? (
                posts === null ? (
                  <GridLoading />
                ) : posts.length === 0 ? (
                  <EmptyGrid body="Posts you publish will show up here." />
                ) : (
                  <div className="grid grid-cols-3 gap-0.5">
                    {posts.map((p) => (
                      <PostsTile key={p.id} post={p} />
                    ))}
                  </div>
                )
              ) : collection === null ? (
                <GridLoading />
              ) : collection.length === 0 ? (
                <EmptyGrid body="Unlock a post to start your collection." />
              ) : (
                <div className="grid grid-cols-3 gap-0.5">
                  {collection.map((c) => (
                    <CollectionTile key={c.postId} item={c} />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <BottomNav />
      <SettingsDrawer open={drawer} onClose={() => setDrawer(false)} />
      {editOpen && (
        <EditProfileSheet
          current={profile?.username ?? ""}
          currentAvatar={profile?.avatar ?? profile?.imageUrl ?? null}
          currentName={displayName}
          closing={editClosing}
          onClose={closeEdit}
          onSaved={(p) => {
            setProfile((current) => ({ ...(current ?? p), ...p } as Profile));
            closeEdit();
          }}
        />
      )}
    </main>
  );
}

function StatCol({
  label,
  value,
  href,
  divider,
}: {
  label: string;
  value: string;
  href?: string;
  divider?: boolean;
}) {
  const inner = (
    <>
      <div className="tabular text-[18px] font-bold">{value}</div>
      <div className="text-muted mt-0.5 text-[12px]">{label}</div>
    </>
  );
  const cls = `flex-1 text-center ${divider ? "border-hairline border-l" : ""}`;

  return href ? (
    <Link
      href={href}
      className={`${cls} block rounded-md transition-opacity active:opacity-70`}
    >
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

function TabButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof LayoutGrid;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="flex items-center gap-1.5 px-1 pb-2.5 pr-4 text-[13px] font-semibold transition-colors"
      style={{
        color: active ? "var(--text)" : "var(--muted)",
        borderBottom: active ? "2px solid var(--primary)" : "2px solid transparent",
        marginBottom: -1,
      }}
    >
      <Icon size={16} strokeWidth={2} />
      {label}
    </button>
  );
}

function PostsTile({ post }: { post: PostTile }) {
  const locked = Number(post.unlockPrice) > 0;
  return (
    <div
      className="bg-surface-2 relative overflow-hidden"
      style={{ aspectRatio: "1" }}
    >
      {post.previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={post.previewUrl}
          alt={post.title}
          className="size-full object-cover"
        />
      ) : (
        <div className="bg-surface-2 size-full" />
      )}
      {post.mediaType === "video" && (
        <span className="absolute left-1.5 top-1.5 text-white/90 drop-shadow">
          <Play size={14} fill="currentColor" />
        </span>
      )}
      {locked && (
        <span
          className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-pill px-1.5 py-0.5 text-[10px] font-medium text-white"
          style={{ background: "rgba(8,6,8,.6)", backdropFilter: "blur(4px)" }}
        >
          <Lock size={10} />
          <span className="tabular">{post.priceLabel}</span>
        </span>
      )}
    </div>
  );
}

function CollectionTile({ item }: { item: CollectionItem }) {
  return item.mediaType === "video" ? (
    <video
      src={item.url}
      aria-label={item.title}
      className="bg-surface-2 size-full object-cover"
      style={{ aspectRatio: "1" }}
      muted
      playsInline
    />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={item.url}
      alt={item.title}
      className="bg-surface-2 size-full object-cover"
      style={{ aspectRatio: "1" }}
    />
  );
}

function GridLoading() {
  return <p className="text-faint py-10 text-center text-sm">Loading…</p>;
}

function EmptyGrid({ body }: { body: string }) {
  return (
    <p className="text-faint px-8 py-12 text-center text-[13.5px]">{body}</p>
  );
}

function fmtCompact(n: number | undefined): string {
  if (n == null) return "—";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

function EditProfileSheet({
  current,
  currentAvatar,
  currentName,
  closing = false,
  onClose,
  onSaved,
}: {
  current: string;
  currentAvatar: string | null;
  currentName: string;
  closing?: boolean;
  onClose: () => void;
  onSaved: (p: Partial<Profile>) => void;
}) {
  const [name, setName] = useState(current);
  const [avatar, setAvatar] = useState(currentAvatar);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        body: JSON.stringify({ username: name, avatar }),
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

  async function chooseAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    setError(null);
    try {
      const nextAvatar = await resizeProfileImage(file);
      setAvatar(nextAvatar);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not use that image");
    } finally {
      setUploadingAvatar(false);
      event.target.value = "";
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
        style={{
          animation: closing
            ? "vfade .18s ease reverse both"
            : "vscrim .2s ease both",
        }}
        onClick={onClose}
      />
      <div
        className="bg-surface border-hairline relative max-h-[88dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-card border-t p-5"
        style={{
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 22px)",
          animation: closing
            ? "vsheetout .22s cubic-bezier(.22,1,.36,1) both"
            : "vsheet .3s cubic-bezier(.22,1,.36,1) both",
        }}
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
        <div className="mb-5 flex flex-col items-center">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="group relative rounded-full"
            aria-label="Choose profile picture"
          >
            <Avatar name={currentName} src={avatar} size="xl" />
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/0 transition-colors group-hover:bg-black/35">
              <span className="bg-primary text-primary-fg absolute -right-1 bottom-1 flex size-8 items-center justify-center rounded-full shadow-cta">
                <Camera size={16} />
              </span>
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={chooseAvatar}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingAvatar || saving}
            className="text-primary hover:text-primary-hover mt-3 text-[13px] font-bold disabled:opacity-60"
          >
            {uploadingAvatar
              ? "Preparing image..."
              : avatar
                ? "Change profile picture"
                : "Add profile picture"}
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label htmlFor="profile-username" className="text-faint text-[12.5px]">
            Username
          </label>
          <div className="bg-surface-2 border-hairline mt-1.5 flex items-center rounded-md border px-3 focus-within:border-[color:var(--primary)]">
            <span className="text-faint">@</span>
            <input
              id="profile-username"
              name="username"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="yourname..."
              autoComplete="off"
              spellCheck={false}
              className="text-text placeholder:text-faint h-[46px] flex-1 bg-transparent px-1 outline-none"
            />
          </div>
          <p className="text-faint mt-2 text-[12px]">
            3-20 chars: a-z, 0-9, underscore.
          </p>
          {error && <p className="text-danger mt-2 text-[13px]">{error}</p>}
          <Button
            className="mt-4 h-[48px] w-full"
            onClick={save}
            disabled={saving || uploadingAvatar || !name.trim()}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </form>
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
  return Number.isFinite(v)
    ? v.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : "0";
}

function resizeProfileImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    return Promise.reject(new Error("Choose an image file"));
  }
  if (file.size > 6 * 1024 * 1024) {
    return Promise.reject(new Error("Image must be under 6 MB"));
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const size = 512;
      const sourceSize = Math.min(img.naturalWidth, img.naturalHeight);
      const sourceX = Math.max(0, (img.naturalWidth - sourceSize) / 2);
      const sourceY = Math.max(0, (img.naturalHeight - sourceSize) / 2);
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Could not prepare image"));
        return;
      }
      ctx.drawImage(img, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);
      resolve(canvas.toDataURL("image/jpeg", 0.86));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image"));
    };
    img.src = url;
  });
}
