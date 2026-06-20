import "server-only";

import { getThreadFor, getMessages } from "./db/messages";
import { presignPrivateGet } from "./blob";
import { formatUsd } from "./constants";
import { BOT_WALLET_ADDRESS } from "./bot";

// A conversation is resolved per-viewer (PPV cards depend on the viewer's unlock
// state), so this lives server-side and is shared by the DM page (initial,
// server-rendered load) and GET /api/messages/[id] (client refresh after a send).

export type ConversationThread = {
  id: string;
  name: string;
  avatar: string | null;
  isBot: boolean;
  /** Whether the *viewer* is the creator side — gates PPV composing. */
  viewerIsCreator: boolean;
};

export type ConversationTextMsg = {
  id: string;
  kind: "text";
  me: boolean;
  text: string;
};

export type ConversationPpvMsg = {
  id: string;
  kind: "ppv";
  me: boolean;
  revealed: boolean;
  title: string;
  caption: string;
  url?: string | null;
  mediaType?: "image" | "video";
  postId?: string;
  price?: string;
  priceLabel?: string;
  previewUrl?: string | null;
};

export type ConversationCallMsg = {
  id: string;
  kind: "call";
  me: boolean;
  /** Connected call duration in seconds (0 for a call that barely connected). */
  seconds: number;
};

export type ConversationMsg =
  | ConversationTextMsg
  | ConversationPpvMsg
  | ConversationCallMsg;

export type ConversationView = {
  thread: ConversationThread;
  messages: ConversationMsg[];
};

/**
 * Build a viewer-resolved conversation: text messages pass through; PPV messages
 * reveal the real media for an unlocked recipient (short-lived signed URL) or the
 * blurred preview + price for everyone else. Returns null when the thread is
 * missing or the user isn't a participant (authorization). Does NOT mark the
 * thread read — the caller decides (and should do it off the response path).
 */
export async function buildConversationView(
  userId: string,
  threadId: string,
): Promise<ConversationView | null> {
  // Independent reads — fetch in parallel instead of awaiting one then the other.
  const [thread, rows] = await Promise.all([
    getThreadFor(userId, threadId),
    getMessages(threadId, userId),
  ]);
  if (!thread) return null;

  const messages = await Promise.all(
    rows.map(async (m): Promise<ConversationMsg> => {
      const me = m.senderId === userId;
      if (m.kind === "call") {
        return { id: m.id, kind: "call", me, seconds: Number(m.body) || 0 };
      }
      if (m.kind !== "ppv" || !m.postId) {
        return { id: m.id, kind: "text", me, text: m.body ?? "" };
      }
      // Recipient who has paid → reveal the real media.
      if (!me && m.viewerUnlockId) {
        return {
          id: m.id,
          kind: "ppv",
          me,
          revealed: true,
          title: m.postTitle ?? "",
          caption: m.body ?? "",
          url: m.privateMediaKey
            ? await presignPrivateGet(m.privateMediaKey, 300)
            : null,
          mediaType: m.mediaType ?? undefined,
        };
      }
      // Sender's own card, or a recipient who hasn't unlocked → preview only.
      return {
        id: m.id,
        kind: "ppv",
        me,
        revealed: false,
        postId: m.postId,
        title: m.postTitle ?? "",
        caption: m.body ?? "",
        price: m.unlockPrice ?? "0",
        priceLabel: m.unlockPrice ? `$${formatUsd(m.unlockPrice)}` : "$0",
        previewUrl: m.blurredPreviewUrl
          ? await presignPrivateGet(m.blurredPreviewUrl, 3600)
          : null,
        mediaType: m.mediaType ?? undefined,
      };
    }),
  );

  const other = thread.creatorId === userId ? thread.fan : thread.creator;
  return {
    thread: {
      id: thread.id,
      name: other.username ?? `@${other.walletAddress.slice(2, 8).toLowerCase()}`,
      avatar: other.avatar,
      isBot: other.walletAddress.toLowerCase() === BOT_WALLET_ADDRESS,
      viewerIsCreator: thread.creatorId === userId,
    },
    messages,
  };
}
