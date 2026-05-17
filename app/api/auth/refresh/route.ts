import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { rotateSession, sessionCookieNames } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST() {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(sessionCookieNames.refreshCookie)?.value;
  if (!refreshToken) {
    return NextResponse.json({ error: "Missing refresh token" }, { status: 401 });
  }

  try {
    await rotateSession(refreshToken);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid refresh token" }, { status: 401 });
  }
}
