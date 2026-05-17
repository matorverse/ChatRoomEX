import { jwtVerify, SignJWT } from "jose";

const accessSecret = new TextEncoder().encode(process.env.JWT_ACCESS_SECRET ?? "dev-access-secret");
const refreshSecret = new TextEncoder().encode(process.env.JWT_REFRESH_SECRET ?? "dev-refresh-secret");

export type SessionClaims = {
  sub: string;
  sid: string;
  typ: "access" | "refresh";
};

export async function verifyAccessToken(token: string): Promise<SessionClaims> {
  const { payload } = await jwtVerify(token, accessSecret, {
    algorithms: ["HS256"]
  });

  if (payload.typ !== "access" || typeof payload.sub !== "string" || typeof payload.sid !== "string") {
    throw new Error("Invalid access token");
  }

  return payload as SessionClaims;
}

export async function verifyRefreshToken(token: string): Promise<SessionClaims> {
  const { payload } = await jwtVerify(token, refreshSecret, {
    algorithms: ["HS256"]
  });

  if (payload.typ !== "refresh" || typeof payload.sub !== "string" || typeof payload.sid !== "string") {
    throw new Error("Invalid refresh token");
  }

  return payload as SessionClaims;
}

export async function issueAccessToken(userId: string, sessionId: string) {
  return new SignJWT({ typ: "access", sid: sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(accessSecret);
}

export async function issueRefreshToken(userId: string, sessionId: string) {
  return new SignJWT({ typ: "refresh", sid: sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(refreshSecret);
}
