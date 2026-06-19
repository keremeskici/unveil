import { getCreatorStats } from "@/lib/db/social";
import {
  requireCurrentAppUser,
  unauthorizedJson,
  UnauthorizedError,
} from "@/lib/app-user";

export const runtime = "nodejs";

/** GET /api/profile/stats — headline counts for the signed-in user's profile. */
export async function GET() {
  let user;
  try {
    user = await requireCurrentAppUser();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedJson();
    throw err;
  }

  const stats = await getCreatorStats(user.id);
  return Response.json(stats);
}
