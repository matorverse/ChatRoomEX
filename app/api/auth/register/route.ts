import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { auditLog } from "@/lib/security/audit";

export const runtime = "nodejs";

const registerSchema = z.object({
  handle: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,32}$/),
  displayName: z.string().trim().min(1).max(80),
  password: z.string().min(12).max(128)
});

export async function POST(request: Request) {
  const parsed = registerSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid registration details" }, { status: 400 });
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        handle: parsed.data.handle,
        displayName: parsed.data.displayName,
        passwordHash
      },
      select: { id: true, handle: true, displayName: true, avatarUrl: true }
    });

    const room = await tx.room.create({
      data: {
        slug: `${parsed.data.handle}-sanctuary`,
        name: "Sanctuary",
        description: "A calm starter room for realtime chat.",
        createdById: created.id
      },
      select: { id: true }
    });

    await tx.roomMember.create({
      data: {
        roomId: room.id,
        userId: created.id,
        role: "owner",
        canModerate: true
      }
    });

    return created;
  });

  await createSession(user.id);
  await auditLog({ actorId: user.id, action: "auth.registered" });
  return NextResponse.json({ user }, { status: 201 });
}
