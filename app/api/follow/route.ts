import { NextRequest, NextResponse } from "next/server";
import { getUserById, getUserByUsername } from "@/lib/db/queries";
import { toggleFollow } from "@/lib/db/social";
import {
  requireCurrentAppUser,
  setAccountCookie,
  unauthorizedJson,
  UnauthorizedError,
} from "@/lib/app-user";

export const runtime = "nodejs";

/** POST /api/follow — toggle following a creator. Body: { userId } or { username }. */
export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireCurrentAppUser();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedJson();
    throw err;
  }

  const { userId, username } = (await req.json()) as {
    userId?: string;
    username?: string;
  };

  const target = userId
    ? await getUserById(userId)
    : username
      ? await getUserByUsername(username)
      : null;

  if (!target) return Response.json({ error: "User not found" }, { status: 404 });
  if (target.id === user.id) {
    return Response.json({ error: "You can't follow yourself" }, { status: 400 });
  }

  const result = await toggleFollow(user.id, target.id);
  return setAccountCookie(NextResponse.json(result), user.id);
}
