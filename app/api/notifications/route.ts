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
};

/**
 * GET /api/notifications — derived activity feed unioning the events on this
 * user's content: unlocks ("unveiled"), tips ("tipped you"), comments
 * ("commented on"), and follows ("started following you"). No dedicated table.
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
      r.actorUsername ?? `@${r.actorWallet.slice(2, 8).toLowerCase()}`;
    const net =
      r.amount != null
        ? `+$${(parseFloat(r.amount) * CREATOR_CUT).toFixed(2)}`
        : "";
    return {
      id: `${r.type}:${r.id}`,
      type: r.type,
      actor,
      avatar: r.actorAvatar,
      action: ACTION[r.type],
      postTitle: r.postTitle ?? "",
      amount: net,
      at: r.at,
    };
  });

  return Response.json({ items });
}
