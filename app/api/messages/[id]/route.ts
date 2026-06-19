import { NextRequest, after } from "next/server";
import { getPost } from "@/lib/db/queries";
import { getThreadFor, markThreadRead, sendMessage } from "@/lib/db/messages";
import { buildConversationView } from "@/lib/messages-view";
import { maybeReplyToBotThread } from "@/lib/bot";
import {
  requireCurrentAppUser,
  unauthorizedJson,
  UnauthorizedError,
} from "@/lib/app-user";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/messages/[id] — a conversation. PPV messages are resolved
 * per-viewer: the sender sees their locked card, an unlocked recipient gets a
 * presigned real-media URL, everyone else gets the blurred preview + price.
 * Used for client refreshes after a send — the initial load is server-rendered
 * by app/messages/[id]/page.tsx via the same builder.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  let user;
  try {
    user = await requireCurrentAppUser();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedJson();
    throw err;
  }

  const view = await buildConversationView(user.id, id);
  if (!view) return Response.json({ error: "Thread not found" }, { status: 404 });

  // Clearing the unread badge is a side effect — don't make the response wait
  // on the write. `after` runs it once the response is on its way.
  after(() => markThreadRead(id, user.id));

  return Response.json(view);
}

/**
 * POST /api/messages/[id] — send a message.
 * Body: { kind?: "text"|"ppv", body?, postId? }. PPV is creator-only and
 * must reference one of the creator's own posts (it reuses the unlock flow).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { kind = "text", body, postId } = (await req.json()) as {
    kind?: "text" | "ppv";
    body?: string;
    postId?: string;
  };

  let user;
  try {
    user = await requireCurrentAppUser();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedJson();
    throw err;
  }

  const thread = await getThreadFor(user.id, id);
  if (!thread) return Response.json({ error: "Thread not found" }, { status: 404 });

  if (kind === "ppv") {
    if (thread.creatorId !== user.id) {
      return Response.json(
        { error: "Only the creator can send locked content" },
        { status: 403 },
      );
    }
    if (!postId) {
      return Response.json({ error: "postId required for PPV" }, { status: 400 });
    }
    const post = await getPost(postId);
    if (!post || post.creatorId !== user.id) {
      return Response.json({ error: "Not your post" }, { status: 400 });
    }
    const msg = await sendMessage({
      threadId: id,
      senderId: user.id,
      kind: "ppv",
      body: body?.trim() || null,
      postId,
    });
    return Response.json({ ok: true, id: msg.id });
  }

  const text = body?.trim();
  if (!text) return Response.json({ error: "Empty message" }, { status: 400 });

  const msg = await sendMessage({
    threadId: id,
    senderId: user.id,
    kind: "text",
    body: text,
  });
  const botReply = await maybeReplyToBotThread(id, user.id);
  return Response.json({ ok: true, id: msg.id, botReply });
}
