import { NextRequest } from "next/server";
import { updateUserProfileById } from "@/lib/db/queries";
import {
  requireCurrentAppUser,
  unauthorizedJson,
  UnauthorizedError,
} from "@/lib/app-user";
import { ensureUserTempoWallet } from "@/lib/custodial-wallets";

export const runtime = "nodejs";

// 3–20 chars, lowercase letters/digits/underscore. Matches the unique column.
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const AVATAR_DATA_URL_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i;
const AVATAR_URL_RE = /^https?:\/\/\S+$/i;
const MAX_AVATAR_LENGTH = 500_000;

/** GET /api/user — editable profile fields for the signed-in user. */
export async function GET() {
  let user;
  try {
    user = await requireCurrentAppUser();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedJson();
    throw err;
  }
  const tempoWallet = await ensureUserTempoWallet(user.id);
  return Response.json({
    user: {
      username: user.username,
      avatar: user.avatar,
      isCreator: user.isCreator,
      walletAddress: user.walletAddress,
      tempoWalletAddress: tempoWallet.address,
      displayName: user.displayName,
      email: user.email,
      imageUrl: user.imageUrl,
    },
  });
}

/** PATCH /api/user — update username/avatar for the signed-in user. */
export async function PATCH(req: NextRequest) {
  const { username, avatar } = (await req.json()) as {
    username?: string;
    avatar?: string | null;
  };

  const patch: { username?: string; avatar?: string | null } = {};
  if (username !== undefined) {
    const u = username.trim().toLowerCase();
    if (!USERNAME_RE.test(u)) {
      return Response.json(
        { error: "Username must be 3–20 chars: a–z, 0–9, _" },
        { status: 400 },
      );
    }
    patch.username = u;
  }
  if (avatar !== undefined) {
    if (avatar === null) {
      patch.avatar = null;
    } else if (typeof avatar !== "string") {
      return Response.json(
        { error: "Profile picture must be a valid image" },
        { status: 400 },
      );
    } else {
      const a = avatar.trim();
      if (
        a &&
        (a.length > MAX_AVATAR_LENGTH ||
          (!AVATAR_DATA_URL_RE.test(a) && !AVATAR_URL_RE.test(a)))
      ) {
        return Response.json(
          { error: "Profile picture must be a valid image" },
          { status: 400 },
        );
      }
      patch.avatar = a || null;
    }
  }

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    const current = await requireCurrentAppUser();
    const user = await updateUserProfileById(current.id, patch);
    const tempoWallet = await ensureUserTempoWallet(user.id);
    return Response.json({
      user: {
        username: user.username,
        avatar: user.avatar,
        isCreator: user.isCreator,
        walletAddress: user.walletAddress,
        tempoWalletAddress: tempoWallet.address,
        displayName: user.displayName,
        email: user.email,
        imageUrl: user.imageUrl,
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedJson();
    // Unique-violation on username → 409.
    const code = (err as { code?: string })?.code;
    if (code === "23505") {
      return Response.json({ error: "Username already taken" }, { status: 409 });
    }
    return Response.json(
      { error: err instanceof Error ? err.message : "Update failed" },
      { status: 500 },
    );
  }
}
