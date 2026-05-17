import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { clearSessionCookies, hashToken, sessionCookieNames } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

export async function POST() {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(sessionCookieNames.refreshCookie)?.value;
  if (refreshToken) {
    await prisma.authSession.updateMany({
      where: { refreshHash: hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() }
    });
  }

  await clearSessionCookies();
  return NextResponse.json({ ok: true });
}
