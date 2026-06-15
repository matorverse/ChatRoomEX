import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

export async function auditLog(input: {
  actorId?: string;
  roomId?: string;
  action: string;
  metadata?: Record<string, unknown>;
  ipHash?: string | null;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: input.actorId,
        roomId: input.roomId,
        action: input.action,
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
        ipHash: input.ipHash
      }
    });
  } catch (error) {
    console.error("Failed to write audit log:", error);
  }
}
