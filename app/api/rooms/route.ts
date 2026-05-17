import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

export async function GET() {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rooms = await prisma.room.findMany({
    where: { members: { some: { userId: session.userId } } },
    select: {
      id: true,
      slug: true,
      name: true,
      type: true,
      description: true,
      updatedAt: true,
      members: { where: { userId: session.userId }, select: { role: true, canPost: true, canReact: true, canModerate: true } }
    },
    orderBy: { updatedAt: "desc" },
    take: 80
  });

  return NextResponse.json({ rooms });
}
