"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Heart, Pin, X } from "lucide-react";
import { Avatar } from "./ui/Avatar";
import { useAppAuth } from "./useAppAuth";
import { timeAgo } from "@/lib/time";
import type { CommentNode } from "@/lib/db/social";

const REACTS = ["🤍", "🙌", "🔥", "👏", "😍", "😮"];

function haptic(pattern: number | number[]) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      /* unsupported */
    }
  }
}

/**
 * Instagram-style comments bottom sheet (mirrors the prototype). Reads/writes
 * via /api/posts/[id]/comments and /api/comments/[id]/like.
 */
export function CommentsSheet({
  postId,
  caption,
  authorHandle,
  authorAvatar,
  postedAt,
  onClose,
  onCountChange,
}: {
  postId: string;
  caption: string;
  authorHandle: string;
  authorAvatar: string | null;
  postedAt?: string;
  onClose: () => void;
  onCountChange?: (delta: number) => void;
}) {
  const router = useRouter();
  const { isSignedIn } = useAppAuth();
  const [items, setItems] = useState<CommentNode[] | null>(null);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: string; who: string } | null>(
    null,
  );
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const load = useCallback(() => {
    fetch(`/api/posts/${postId}/comments`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setItems(d.items ?? []))
      .catch(() => setItems([]));
  }, [postId]);

  useEffect(() => load(), [load]);

  const toggleLike = useCallback(
    async (id: string, isReply: boolean, parentId?: string) => {
      if (!isSignedIn) {
        router.push("/sign-in");
        return;
      }
      haptic(6);
      // Optimistic flip.
      setItems((prev) =>
        prev
          ? prev.map((c) => {
              if (!isReply && c.id === id) {
                const liked = !c.liked;
                return {
                  ...c,
                  liked,
                  likeCount: c.likeCount + (liked ? 1 : -1),
                };
              }
              if (isReply && c.id === parentId) {
                return {
                  ...c,
                  replies: c.replies.map((r) =>
                    r.id === id
                      ? {
                          ...r,
                          liked: !r.liked,
                          likeCount: r.likeCount + (r.liked ? -1 : 1),
                        }
                      : r,
                  ),
                };
              }
              return c;
            })
          : prev,
      );
      try {
        await fetch(`/api/comments/${id}/like`, { method: "POST" });
      } catch {
        load(); // reconcile on failure
      }
    },
    [isSignedIn, load, router],
  );

  const submit = useCallback(async () => {
    const body = text.trim();
    if (!body || posting) return;
    if (!isSignedIn) {
      router.push("/sign-in");
      return;
    }
    setPosting(true);
    haptic(6);
    try {
      const res = await fetch(`/api/posts/${postId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, parentId: replyTo?.id ?? null }),
      });
      if (res.ok) {
        setText("");
        setReplyTo(null);
        onCountChange?.(1);
        load();
      }
    } finally {
      setPosting(false);
    }
  }, [text, posting, isSignedIn, postId, replyTo, onCountChange, load, router]);

  const startReply = (id: string, who: string) => {
    setReplyTo({ id, who });
    inputRef.current?.focus();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Comments"
      className="bg-bg fixed inset-0 z-50 flex flex-col"
      style={{ animation: "vsheet .3s cubic-bezier(.22,1,.36,1) both" }}
    >
      <div className="mx-auto flex h-full w-full max-w-md flex-col">
        {/* Header */}
        <div
          className="border-hairline bg-surface relative flex items-center justify-center border-b px-4 pb-2.5"
          style={{ paddingTop: "max(13px, env(safe-area-inset-top, 0px))" }}
        >
          <div className="bg-hairline-strong absolute top-[7px] left-1/2 h-1 w-9 -translate-x-1/2 rounded-full" />
          <span className="mt-1 text-base font-bold">Comments</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted hover:text-text absolute right-3 top-1/2 flex size-[34px] -translate-y-1/2 items-center justify-center"
          >
            <X size={22} />
          </button>
        </div>

        {/* Scroll area */}
        <div className="flex-1 overflow-y-auto">
          {/* Caption row */}
          <div className="border-hairline flex gap-2.5 border-b px-4 pt-[15px] pb-3">
            <Avatar name={authorHandle} src={authorAvatar} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="text-text text-sm leading-relaxed">
                <span className="font-semibold">@{authorHandle}</span> {caption}
              </p>
              {postedAt && (
                <p className="text-faint mt-1.5 text-xs">{timeAgo(postedAt)}</p>
              )}
            </div>
          </div>

          {items === null ? (
            <p className="text-faint mt-10 text-center text-sm">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-faint mt-12 text-center text-sm">
              No comments yet — be the first.
            </p>
          ) : (
            items.map((c) => (
              <div key={c.id} className="flex gap-2.5 px-4 py-3">
                <Avatar name={c.who} src={c.avatar} size="sm" />
                <div className="min-w-0 flex-1">
                  {c.pinned && (
                    <div className="text-faint mb-1 flex items-center gap-1.5 text-[11px]">
                      <Pin size={12} />
                      <span>Pinned by creator</span>
                    </div>
                  )}
                  <p className="text-text text-sm leading-relaxed">
                    <span className="font-semibold">{c.who}</span> {c.text}
                  </p>
                  <div className="text-faint mt-1.5 flex items-center gap-4 text-xs font-semibold">
                    <span>{timeAgo(c.at)}</span>
                    {c.likeCount > 0 && <span>{c.likeCount} likes</span>}
                    <button
                      type="button"
                      onClick={() => startReply(c.id, c.who)}
                      className="hover:text-text"
                    >
                      Reply
                    </button>
                  </div>

                  {c.replies.map((r) => (
                    <div key={r.id} className="mt-3 flex gap-2.5">
                      <Avatar name={r.who} src={r.avatar} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="text-text text-[13.5px] leading-relaxed">
                          <span className="font-semibold">{r.who}</span> {r.text}
                        </p>
                        <div className="text-faint mt-1.5 flex items-center gap-4 text-xs font-semibold">
                          <span>{timeAgo(r.at)}</span>
                          {r.likeCount > 0 && <span>{r.likeCount} likes</span>}
                        </div>
                      </div>
                      <LikeBtn
                        liked={r.liked}
                        onClick={() => toggleLike(r.id, true, c.id)}
                      />
                    </div>
                  ))}
                </div>
                <LikeBtn liked={c.liked} onClick={() => toggleLike(c.id, false)} />
              </div>
            ))
          )}
          <div className="h-2" />
        </div>

        {/* Emoji quick reacts */}
        <div className="border-hairline flex items-center justify-between border-t px-[18px] pt-2.5 pb-[7px]">
          {REACTS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setText((t) => t + e)}
              className="text-[23px] leading-none"
            >
              {e}
            </button>
          ))}
        </div>

        {/* Composer */}
        <div
          className="border-hairline bg-surface border-t px-3.5 pt-2"
          style={{
            paddingBottom: "max(20px, env(safe-area-inset-bottom, 0px))",
          }}
        >
          {replyTo && (
            <div className="text-faint mb-1.5 flex items-center justify-between px-1 text-xs">
              <span>Replying to {replyTo.who}</span>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                className="hover:text-text font-semibold"
              >
                Cancel
              </button>
            </div>
          )}
          <div className="bg-surface-2 border-hairline flex items-center gap-2 rounded-pill border py-[7px] pr-[7px] pl-4">
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder={replyTo ? `Reply to ${replyTo.who}…` : "Add a comment…"}
              className="text-text min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
            <button
              type="button"
              onClick={submit}
              disabled={!text.trim() || posting}
              className="h-[30px] rounded-pill px-3.5 text-[13.5px] font-bold transition-colors"
              style={{
                background: text.trim() ? "var(--primary)" : "transparent",
                color: text.trim() ? "#fff" : "var(--faint)",
              }}
            >
              Post
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LikeBtn({ liked, onClick }: { liked: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={liked ? "Unlike" : "Like"}
      className="mt-0.5 flex shrink-0 items-start self-start transition-transform active:scale-[0.85]"
    >
      <Heart
        size={17}
        strokeWidth={2}
        style={{
          fill: liked ? "var(--primary)" : "none",
          color: liked ? "var(--primary)" : "var(--faint)",
          animation: liked
            ? "vlikepop .42s cubic-bezier(.22,1,.36,1)"
            : undefined,
        }}
      />
    </button>
  );
}
