import { NextRequest, NextResponse } from "next/server";
import { toggleCommentLike } from "@/lib/db/social";
import {
  requireCurrentAppUser,
  setAccountCookie,
  unauthorizedJson,
  UnauthorizedError,
} from "@/lib/app-user";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** POST /api/comments/[id]/like — toggle the current user's like on a comment. */
export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  let user;
  try {
    user = await requireCurrentAppUser();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedJson();
    throw err;
  }

  const result = await toggleCommentLike(user.id, id);
  return setAccountCookie(NextResponse.json(result), user.id);
}
