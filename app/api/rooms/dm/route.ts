import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getCurrentSession } from "@/lib/auth/session";

export const runtime = "nodejs";

const dmSchema = z.object({
  targetUserId: z.string().uuid()
});

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = dmSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid target user" }, { status: 400 });

  if (session.userId === parsed.data.targetUserId) {
    return NextResponse.json({ error: "Cannot DM yourself" }, { status: 400 });
  }

  // Check if a DM room already exists between these two users
  const existingDm = await prisma.room.findFirst({
    where: {
      isPrivate: true,
      AND: [
        { members: { some: { userId: session.userId } } },
        { members: { some: { userId: parsed.data.targetUserId } } }
      ]
    },
    select: { id: true }
  });

  if (existingDm) {
    return NextResponse.json({ roomId: existingDm.id });
  }

  // Find target user name and current user name in parallel to set the room name
  const [targetUser, currentUser] = await Promise.all([
    prisma.user.findUnique({ where: { id: parsed.data.targetUserId } }),
    prisma.user.findUnique({ where: { id: session.userId } })
  ]);
  if (!targetUser) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // Create new DM room
  const room = await prisma.$transaction(async (tx) => {
    const created = await tx.room.create({
      data: {
        slug: `dm-${session.userId}-${targetUser.id}`,
        name: `${currentUser?.displayName} & ${targetUser.displayName}`,
        description: "Direct Message",
        isPrivate: true,
        createdById: session.userId
      }
    });

    await tx.roomMember.createMany({
      data: [
        { roomId: created.id, userId: session.userId, role: "owner", canModerate: true },
        { roomId: created.id, userId: targetUser.id, role: "member", canModerate: false }
      ]
    });

    return created;
  });

  return NextResponse.json({ roomId: room.id }, { status: 201 });
}
