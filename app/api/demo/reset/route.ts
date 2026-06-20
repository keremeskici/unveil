import { NextResponse } from "next/server";
import {
  requireCurrentAppUser,
  unauthorizedJson,
  UnauthorizedError,
} from "@/lib/app-user";
import { resetDemoUserState } from "@/lib/demo-reset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const user = await requireCurrentAppUser();
    const result = await resetDemoUserState(user);
    const res = NextResponse.json(result);
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedJson();
    throw err;
  }
}
