import { prisma } from "@/lib/db/prisma";

export async function requireRoomMember(userId: string, roomId: string) {
  const member = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId } },
    select: { role: true, canPost: true, canReact: true, canModerate: true }
  });

  if (!member) {
    throw new Error("Forbidden");
  }

  return member;
}
