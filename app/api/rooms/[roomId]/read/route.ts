import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth/session";
import { requireRoomMember } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

const bodySchema = z.object({ messageId: z.string().uuid() });

export async function POST(request: Request, context: { params: Promise<{ roomId: string }> }) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { roomId } = await context.params;
  await requireRoomMember(session.userId, roomId);
  const body = bodySchema.parse(await request.json());

  const receipt = await prisma.readReceipt.upsert({
    where: { roomId_userId_messageId: { roomId, userId: session.userId, messageId: body.messageId } },
    create: { roomId, userId: session.userId, messageId: body.messageId },
    update: { readAt: new Date() }
  });

  return NextResponse.json({ readAt: receipt.readAt.toISOString() });
}
