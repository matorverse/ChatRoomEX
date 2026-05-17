import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth/session";
import { requireRoomMember } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

const querySchema = z.object({
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

export async function GET(request: Request, context: { params: Promise<{ roomId: string }> }) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { roomId } = await context.params;
  await requireRoomMember(session.userId, roomId);

  const url = new URL(request.url);
  const parsed = querySchema.parse(Object.fromEntries(url.searchParams));
  const messages = await prisma.message.findMany({
    where: {
      roomId,
      status: { not: "deleted" },
      ...(parsed.before ? { createdAt: { lt: new Date(parsed.before) } } : {})
    },
    select: {
      id: true,
      roomId: true,
      authorId: true,
      body: true,
      threadId: true,
      parentId: true,
      clientNonce: true,
      createdAt: true,
      updatedAt: true
    },
    orderBy: { createdAt: "desc" },
    take: parsed.limit
  });

  return NextResponse.json({
    messages: messages
      .reverse()
      .map((message) => ({ ...message, createdAt: message.createdAt.toISOString(), updatedAt: message.updatedAt.toISOString() }))
  });
}
