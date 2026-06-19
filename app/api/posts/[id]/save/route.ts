import { NextRequest, NextResponse } from "next/server";
import { togglePostSave } from "@/lib/db/social";
import { getPost } from "@/lib/db/queries";
import {
  requireCurrentAppUser,
  setAccountCookie,
  unauthorizedJson,
  UnauthorizedError,
} from "@/lib/app-user";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** POST /api/posts/[id]/save — toggle the current user's bookmark on a post. */
export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  let user;
  try {
    user = await requireCurrentAppUser();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedJson();
    throw err;
  }

  const post = await getPost(id);
  if (!post) return Response.json({ error: "Post not found" }, { status: 404 });

  const result = await togglePostSave(user.id, id);
  return setAccountCookie(NextResponse.json(result), user.id);
}
