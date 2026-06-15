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

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name } = body;
  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "Invalid name" }, { status: 400 });
  }

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + crypto.randomUUID().slice(0, 8);

  const room = await prisma.room.create({
    data: {
      name,
      slug,
      createdById: session.userId,
      members: {
        create: {
          userId: session.userId,
          role: "owner",
          canModerate: true
        }
      }
    }
  });

  return NextResponse.json({ room });
}
