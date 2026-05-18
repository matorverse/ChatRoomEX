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

  const parsed = dmSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid target user" }, { status: 400 });

  if (session.userId === parsed.data.targetUserId) {
    return NextResponse.json({ error: "Cannot DM yourself" }, { status: 400 });
  }

  // Check if a DM room already exists between these two users
  const existingRooms = await prisma.room.findMany({
    where: {
      isPrivate: true,
      members: { some: { userId: session.userId } }
    },
    include: { members: true }
  });

  const existingDm = existingRooms.find((room) => room.members.some((m) => m.userId === parsed.data.targetUserId));
  if (existingDm) {
    return NextResponse.json({ roomId: existingDm.id });
  }

  // Find target user name to set the room name
  const targetUser = await prisma.user.findUnique({ where: { id: parsed.data.targetUserId } });
  if (!targetUser) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const currentUser = await prisma.user.findUnique({ where: { id: session.userId } });

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
