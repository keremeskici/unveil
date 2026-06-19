import { NextRequest, NextResponse } from "next/server";
import {
  getExploreTiles,
  getTopCreators,
  searchEverything,
  type PostTile,
} from "@/lib/db/social";
import { presignPrivateGet } from "@/lib/blob";
import { getCurrentAppUser } from "@/lib/app-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tiles store private preview keys; presign them (best-effort) for the client.
async function presignTiles(tiles: PostTile[]) {
  return Promise.all(
    tiles.map(async (t) => ({
      id: t.id,
      title: t.title,
      mediaType: t.mediaType,
      unlockPrice: t.unlockPrice,
      locked: t.locked,
      previewUrl: await presignPrivateGet(t.blurredPreviewKey, 3600).catch(
        () => null,
      ),
    })),
  );
}

/**
 * GET /api/search?q= — creators + posts matching the query. With no query it
 * returns discovery defaults: top creators and a recent explore grid.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const viewer = await getCurrentAppUser().catch(() => null);

  if (!q) {
    const [creators, tiles] = await Promise.all([
      getTopCreators(viewer?.id, 6),
      getExploreTiles(9),
    ]);
    return NextResponse.json({
      query: "",
      creators,
      tiles: await presignTiles(tiles),
    });
  }

  const { creators, posts } = await searchEverything(q, viewer?.id);
  return NextResponse.json({
    query: q,
    creators,
    tiles: await presignTiles(posts),
  });
}
