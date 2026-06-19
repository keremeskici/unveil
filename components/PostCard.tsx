"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Heart,
  MessageCircle,
  CircleDollarSign,
  Bookmark,
  MoreHorizontal,
  Lock,
} from "lucide-react";
import { Avatar } from "./ui/Avatar";
import { UnlockButton } from "./UnlockButton";
import { RevealMedia } from "./RevealMedia";
import { VideoStage } from "./VideoStage";
import { PartialVideoStage, type PartialRegion } from "./PartialVideoStage";
import { CommentsSheet } from "./CommentsSheet";
import { TipSheet } from "./TipSheet";
import { useAppAuth } from "./useAppAuth";

export type PostSocialState = {
  likeCount: number;
  commentCount: number;
  liked: boolean;
  saved: boolean;
};

export type FeedPost = {
  id: string;
  title: string;
  blurredPreviewUrl: string;
  unlockPrice: string;
  mediaType: "image" | "video";
  accessMode: "full" | "partial";
  poster?: string | null;
  regions?: PartialRegion[];
  createdAt?: string;
  social?: PostSocialState;
  creator: { username: string | null; avatar: string | null; wallet: string | null };
};

function fmtCount(n: number) {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

function haptic(pattern: number | number[]) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      /* unsupported */
    }
  }
}

export function PostCard({
  post,
  isUnlocked: initialUnlocked,
  priority = false,
}: {
  post: FeedPost;
  isUnlocked?: boolean;
  priority?: boolean;
}) {
  const { isSignedIn } = useAppAuth();
  const router = useRouter();
  const free = Number(post.unlockPrice) === 0;
  const [unlocked, setUnlocked] = useState(initialUnlocked ?? false);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [messaging, setMessaging] = useState(false);

  // Social state (optimistic; seeded from the server-rendered feed).
  const [liked, setLiked] = useState(post.social?.liked ?? false);
  const [likeCount, setLikeCount] = useState(post.social?.likeCount ?? 0);
  const [saved, setSaved] = useState(post.social?.saved ?? false);
  const [commentCount, setCommentCount] = useState(
    post.social?.commentCount ?? 0,
  );
  const [burst, setBurst] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);

  const requireAuth = useCallback(() => {
    if (!isSignedIn) {
      router.push("/sign-in");
      return false;
    }
    return true;
  }, [isSignedIn, router]);

  const handleUnlock = useCallback((url: string, _settlementMs: number) => {
    setSignedUrl(url);
    setUnlocked(true);
  }, []);

  const toggleLike = useCallback(async () => {
    if (!requireAuth()) return;
    haptic(6);
    const next = !liked;
    setLiked(next);
    setLikeCount((c) => c + (next ? 1 : -1));
    try {
      const res = await fetch(`/api/posts/${post.id}/like`, { method: "POST" });
      if (res.ok) {
        const d = (await res.json()) as { liked: boolean; likeCount: number };
        setLiked(d.liked);
        setLikeCount(d.likeCount);
      }
    } catch {
      // revert on failure
      setLiked(!next);
      setLikeCount((c) => c - (next ? 1 : -1));
    }
  }, [liked, post.id, requireAuth]);

  const doubleTapLike = useCallback(() => {
    if (!(free || unlocked)) return;
    haptic([5, 30, 8]);
    setBurst(true);
    setTimeout(() => setBurst(false), 900);
    if (!liked) void toggleLike();
  }, [free, unlocked, liked, toggleLike]);

  const toggleSave = useCallback(async () => {
    if (!requireAuth()) return;
    haptic(6);
    const next = !saved;
    setSaved(next);
    try {
      const res = await fetch(`/api/posts/${post.id}/save`, { method: "POST" });
      if (res.ok) {
        const d = (await res.json()) as { saved: boolean };
        setSaved(d.saved);
      }
    } catch {
      setSaved(!next);
    }
  }, [saved, post.id, requireAuth]);

  const openComments = useCallback(() => {
    setCommentsOpen(true);
  }, []);

  const openTip = useCallback(() => {
    if (!requireAuth()) return;
    setTipOpen(true);
  }, [requireAuth]);

  const messageCreator = useCallback(async () => {
    if (!requireAuth()) return;
    if (!post.creator.wallet || messaging) return;
    setMessaging(true);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creatorWallet: post.creator.wallet }),
      });
      if (res.ok) {
        const { threadId } = (await res.json()) as { threadId: string };
        router.push(`/messages/${threadId}`);
      }
    } finally {
      setMessaging(false);
    }
  }, [post.creator.wallet, messaging, router, requireAuth]);

  const username = post.creator.username ?? "creator";
  const revealed = unlocked || free;
  const canDouble = free || unlocked;

  return (
    <article
      className="bg-surface-2 mb-4 overflow-hidden rounded-card"
      style={{ boxShadow: "0 8px 24px rgba(0,0,0,.32)" }}
    >
      {/* Creator header */}
      <header className="flex items-center gap-3 px-4 pt-3.5 pb-3">
        <Avatar name={username} src={post.creator.avatar} size="lg" verified />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-tight font-semibold">{username}</p>
          <p className="text-faint text-[12.5px] leading-snug">@{username}</p>
        </div>
        <button
          type="button"
          onClick={messageCreator}
          disabled={messaging || !post.creator.wallet}
          className="text-faint hover:text-muted flex size-9 items-center justify-center disabled:opacity-50"
          aria-label="Message creator"
        >
          <MoreHorizontal size={20} />
        </button>
      </header>

      {/* Caption */}
      <p className="text-text px-4 pb-3 text-[15.5px] leading-relaxed">
        {post.title}
      </p>

      {/* Media + blur gate / reveal */}
      <div
        className="relative"
        onDoubleClick={canDouble ? doubleTapLike : undefined}
      >
        {(() => {
          // Partial video plays free; each blurred region is its own micro-unlock,
          // so it manages its own gating instead of a whole-post lock overlay.
          if (post.mediaType === "video" && post.accessMode === "partial") {
            return (
              <PartialVideoStage
                postId={post.id}
                previewUrl={post.blurredPreviewUrl}
                price={post.unlockPrice}
                regions={post.regions ?? []}
                poster={post.poster ?? undefined}
              />
            );
          }

          const overlay = !free && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6"
              style={{ background: "rgba(8,6,8,.46)" }}
            >
              <div
                className="border-hairline-strong flex size-[54px] items-center justify-center rounded-full"
                style={{ background: "rgba(8,6,8,.55)", borderWidth: 1 }}
              >
                <Lock size={24} />
              </div>
              <UnlockButton
                postId={post.id}
                price={post.unlockPrice}
                onUnlock={handleUnlock}
              />
            </div>
          );

          return post.mediaType === "video" ? (
            <VideoStage
              previewUrl={post.blurredPreviewUrl}
              revealedUrl={signedUrl}
              revealed={revealed}
              overlay={overlay}
            />
          ) : (
            <RevealMedia
              previewUrl={post.blurredPreviewUrl}
              revealedUrl={signedUrl}
              revealed={revealed}
              alt={post.title}
              priority={priority}
              overlay={overlay}
            />
          );
        })()}

        {/* Double-tap heart burst */}
        {burst && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Heart
              size={104}
              style={{
                fill: "#fff",
                color: "#fff",
                filter: "drop-shadow(0 8px 24px rgba(0,0,0,.5))",
                animation: "vburst .9s cubic-bezier(.22,1,.36,1) both",
              }}
            />
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="px-4 pt-3.5 pb-3.5">
        <div className="text-muted flex items-center gap-4">
          <button
            type="button"
            onClick={toggleLike}
            className="flex items-center gap-1.5 text-[13.5px] transition-transform active:scale-90"
            style={{ color: liked ? "var(--primary)" : undefined }}
            aria-label="Like"
          >
            <Heart
              size={23}
              strokeWidth={1.9}
              style={{
                fill: liked ? "var(--primary)" : "none",
                color: liked ? "var(--primary)" : "currentColor",
                animation: liked
                  ? "vlikepop .42s cubic-bezier(.22,1,.36,1)"
                  : undefined,
              }}
            />
            {likeCount > 0 && <span>{fmtCount(likeCount)}</span>}
          </button>
          <button
            type="button"
            onClick={openComments}
            aria-label="Comments"
            className="hover:text-text flex items-center gap-1.5 text-[13.5px] transition-transform active:scale-90"
          >
            <MessageCircle size={22} strokeWidth={1.9} />
            {commentCount > 0 && <span>{fmtCount(commentCount)}</span>}
          </button>
          <button
            type="button"
            onClick={openTip}
            className="hover:text-text flex items-center gap-1.5 text-[13px] font-semibold transition-transform active:scale-90"
            aria-label="Tip"
          >
            <CircleDollarSign size={22} strokeWidth={1.9} />
            <span>Tip</span>
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={toggleSave}
            aria-label="Save"
            className="hover:text-text flex items-center transition-transform active:scale-90"
            style={{ color: saved ? "var(--primary)" : undefined }}
          >
            <Bookmark
              size={22}
              strokeWidth={1.9}
              style={{
                fill: saved ? "var(--primary)" : "none",
                color: saved ? "var(--primary)" : "currentColor",
                animation: saved
                  ? "vsavepop .42s cubic-bezier(.22,1,.36,1)"
                  : undefined,
              }}
            />
          </button>
        </div>
      </footer>

      {commentsOpen && (
        <CommentsSheet
          postId={post.id}
          caption={post.title}
          authorHandle={username}
          authorAvatar={post.creator.avatar}
          postedAt={post.createdAt}
          onClose={() => setCommentsOpen(false)}
          onCountChange={(d) => setCommentCount((c) => Math.max(0, c + d))}
        />
      )}

      {tipOpen && (
        <TipSheet
          postId={post.id}
          creatorName={username}
          creatorHandle={`@${username}`}
          creatorAvatar={post.creator.avatar}
          onClose={() => setTipOpen(false)}
        />
      )}
    </article>
  );
}
