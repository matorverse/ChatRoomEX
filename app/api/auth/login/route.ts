import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db/prisma";
import { auditLog } from "@/lib/security/audit";
import { fixedWindowRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

const loginSchema = z.object({
  handle: z.string().trim().toLowerCase().min(3).max(32),
  password: z.string().min(1).max(128)
});

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid login details" }, { status: 400 });
  }

  const rate = await fixedWindowRateLimit(`login:${parsed.data.handle}`, 8, 60);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many login attempts" }, { status: 429 });
  }

  const user = await prisma.user.findUnique({
    where: { handle: parsed.data.handle },
    select: { id: true, handle: true, displayName: true, avatarUrl: true, passwordHash: true }
  });

  if (!user?.passwordHash || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  await createSession(user.id);
  await auditLog({ actorId: user.id, action: "auth.logged_in" });
  return NextResponse.json({ user: { id: user.id, handle: user.handle, displayName: user.displayName, avatarUrl: user.avatarUrl } });
}
