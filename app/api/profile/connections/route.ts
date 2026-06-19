import { NextRequest } from "next/server";
import { listFollowers, listFollowing } from "@/lib/db/social";
import {
  requireCurrentAppUser,
  unauthorizedJson,
  UnauthorizedError,
} from "@/lib/app-user";

export const runtime = "nodejs";

/**
 * GET /api/profile/connections?type=followers|following — the signed-in user's
 * followers or the people they follow. `following` on each row reflects whether
 * the viewer follows that user (so a Follow/Following toggle can be rendered).
 */
export async function GET(req: NextRequest) {
  let user;
  try {
    user = await requireCurrentAppUser();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedJson();
    throw err;
  }

  const type = req.nextUrl.searchParams.get("type");
  const users =
    type === "following"
      ? await listFollowing(user.id, user.id)
      : await listFollowers(user.id, user.id);

  return Response.json({ users });
}
