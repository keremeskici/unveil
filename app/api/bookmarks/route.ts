import { listBookmarks } from "@/lib/db/social";
import {
  requireCurrentAppUser,
  unauthorizedJson,
  UnauthorizedError,
} from "@/lib/app-user";

export const runtime = "nodejs";

export async function GET() {
  let user;
  try {
    user = await requireCurrentAppUser();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedJson();
    throw err;
  }

  const rows = await listBookmarks(user.id);
  return Response.json({
    items: rows.map((r) => ({
      id: r.id,
      postId: r.postId,
      title: r.title,
      creator: r.creator,
      avatar: r.avatar,
      at: r.at,
    })),
  });
}
