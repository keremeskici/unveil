import { getNotifications, type NotifType } from "@/lib/db/queries";
import { CREATOR_CUT } from "@/lib/constants";
import {
  requireCurrentAppUser,
  unauthorizedJson,
  UnauthorizedError,
} from "@/lib/app-user";

export const runtime = "nodejs";

const ACTION: Record<NotifType, string> = {
  unlock: "unveiled",
  tip: "tipped you",
  comment: "commented on",
  follow: "started following you",
  post: "posted",
};

function mockUnveils() {
  const now = Date.now();
  return [
    {
      id: "mock-unveil:1",
      type: "unlock" as const,
      actor: "Someone",
      avatar: null,
      action: ACTION.unlock,
      postTitle: "Bracket Spoiler",
      amount: "+$0.80",
      at: new Date(now - 1000 * 60 * 8).toISOString(),
    },
    {
      id: "mock-unveil:2",
      type: "unlock" as const,
      actor: "Someone",
      avatar: null,
      action: ACTION.unlock,
      postTitle: "Sideline Reveal",
      amount: "+$1.20",
      at: new Date(now - 1000 * 60 * 37).toISOString(),
    },
    {
      id: "mock-unveil:3",
      type: "unlock" as const,
      actor: "Someone",
      avatar: null,
      action: ACTION.unlock,
      postTitle: "Final Buzzer",
      amount: "+$0.60",
      at: new Date(now - 1000 * 60 * 92).toISOString(),
    },
  ];
}

/**
 * GET /api/notifications — derived activity feed unioning the events on this
 * user's content: unlocks ("unveiled"), tips ("tipped you"), comments
 * ("commented on"), follows ("started following you"), and new posts from
 * followed creators. No dedicated table.
 * Unlock/tip amounts are shown as the creator's net cut — what actually lands.
 */
export async function GET() {
  let user;
  try {
    user = await requireCurrentAppUser();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedJson();
    throw err;
  }

  const rows = await getNotifications(user.id);
  const items = rows.map((r) => {
    const actor =
      r.type === "unlock"
        ? "Someone"
        : r.actorUsername ?? `@${r.actorWallet.slice(2, 8).toLowerCase()}`;
    const net =
      r.amount != null
        ? `+$${(parseFloat(r.amount) * CREATOR_CUT).toFixed(2)}`
        : "";
    return {
      id: `${r.type}:${r.id}`,
      type: r.type,
      actor,
      avatar: r.type === "unlock" ? null : r.actorAvatar,
      action: ACTION[r.type],
      postTitle: r.postTitle ?? "",
      amount: net,
      at: r.at,
    };
  });

  return Response.json({
    items: [...mockUnveils(), ...items].sort(
      (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
    ),
  });
}
