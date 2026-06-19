import { NextRequest, NextResponse } from "next/server";
import { addComment, listComments } from "@/lib/db/social";
import { getPost } from "@/lib/db/queries";
import {
  getCurrentAppUser,
  requireCurrentAppUser,
  setAccountCookie,
  unauthorizedJson,
  UnauthorizedError,
} from "@/lib/app-user";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** GET /api/posts/[id]/comments — threaded comments for a post (public). */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  // Viewer is optional — anyone can read; a signed-in viewer gets `liked` flags.
  const viewer = await getCurrentAppUser().catch(() => null);
  const items = await listComments(id, viewer?.id);
  return NextResponse.json({ items });
}

/** POST /api/posts/[id]/comments — add a comment or reply (auth required). */
export async function POST(req: NextRequest, { params }: Params) {
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

  const { body, parentId } = (await req.json()) as {
    body?: string;
    parentId?: string | null;
  };
  const text = body?.trim();
  if (!text) {
    return Response.json({ error: "Comment cannot be empty" }, { status: 400 });
  }
  if (text.length > 500) {
    return Response.json({ error: "Comment is too long" }, { status: 400 });
  }

  const comment = await addComment(user.id, id, text, parentId ?? null);
  return setAccountCookie(NextResponse.json({ comment }), user.id);
}
