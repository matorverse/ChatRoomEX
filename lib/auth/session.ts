import { createHash, randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { issueAccessToken, issueRefreshToken, verifyAccessToken, verifyRefreshToken } from "@/lib/auth/jwt";

const accessCookie = "crex_access";
const refreshCookie = "crex_refresh";

export type CurrentSession = {
  userId: string;
  sessionId: string;
  accessToken: string;
};

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}

export function hashIp(ip: string | null) {
  return ip ? createHash("sha256").update(ip).digest("base64url") : null;
}

export async function createSession(userId: string) {
  const sessionId = randomUUID();
  const accessToken = await issueAccessToken(userId, sessionId);
  const refreshToken = await issueRefreshToken(userId, sessionId);
  const requestHeaders = await headers();

  await prisma.authSession.create({
    data: {
      id: sessionId,
      userId,
      refreshHash: hashToken(refreshToken),
      userAgent: requestHeaders.get("user-agent")?.slice(0, 240),
      ipHash: hashIp(requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30)
    }
  });

  await setSessionCookies(accessToken, refreshToken);
  return { accessToken, refreshToken, sessionId };
}

export async function rotateSession(refreshToken: string) {
  const claims = await verifyRefreshToken(refreshToken);
  const existing = await prisma.authSession.findUnique({ where: { id: claims.sid } });
  if (!existing || existing.revokedAt || existing.expiresAt < new Date() || existing.refreshHash !== hashToken(refreshToken)) {
    throw new Error("Invalid session");
  }

  const nextAccess = await issueAccessToken(claims.sub, claims.sid);
  const nextRefresh = await issueRefreshToken(claims.sub, claims.sid);
  await prisma.authSession.update({
    where: { id: claims.sid },
    data: { refreshHash: hashToken(nextRefresh), rotatedAt: new Date() }
  });
  await setSessionCookies(nextAccess, nextRefresh);
  return { accessToken: nextAccess, refreshToken: nextRefresh, sessionId: claims.sid };
}

export async function getCurrentSession(): Promise<CurrentSession | null> {
  const cookieStore = await cookies();
  const headerStore = await headers();
  
  let accessToken = cookieStore.get(accessCookie)?.value;
  if (!accessToken) {
    const authHeader = headerStore.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      accessToken = authHeader.substring(7);
    }
  }

  if (accessToken) {
    try {
      const claims = await verifyAccessToken(accessToken);
      return { userId: claims.sub, sessionId: claims.sid, accessToken };
    } catch {
      // Access token expired, attempt recovery with refresh token
    }
  }

  const refreshToken = cookieStore.get(refreshCookie)?.value;
  if (!refreshToken) return null;

  try {
    const claims = await verifyRefreshToken(refreshToken);
    const existing = await prisma.authSession.findUnique({ where: { id: claims.sid } });
    if (!existing || existing.revokedAt || existing.expiresAt < new Date() || existing.refreshHash !== hashToken(refreshToken)) {
      return null;
    }

    const nextAccess = await issueAccessToken(claims.sub, claims.sid);
    const nextRefresh = await issueRefreshToken(claims.sub, claims.sid);

    await prisma.authSession.update({
      where: { id: claims.sid },
      data: { refreshHash: hashToken(nextRefresh), rotatedAt: new Date() }
    });

    try {
      await setSessionCookies(nextAccess, nextRefresh);
    } catch {
      // Ignore Next.js read-only cookies error in RSC rendering phase
    }

    return { userId: claims.sub, sessionId: claims.sid, accessToken: nextAccess };
  } catch {
    return null;
  }
}

export async function clearSessionCookies() {
  const cookieStore = await cookies();
  cookieStore.delete(accessCookie);
  cookieStore.delete(refreshCookie);
}

async function setSessionCookies(accessToken: string, refreshToken: string) {
  const cookieStore = await cookies();
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") || "";
  const isLocalhostOrIp = /^localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host);
  const secure = process.env.NODE_ENV === "production" && !isLocalhostOrIp;
  
  cookieStore.set(accessCookie, accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 15
  });
  cookieStore.set(refreshCookie, refreshToken, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });
}

export const sessionCookieNames = { accessCookie, refreshCookie };
