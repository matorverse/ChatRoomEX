"use client";

import type { Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@/lib/realtime/events";
import { offlineDb } from "@/lib/offline/db";

export async function flushOfflineQueue(socket: Socket<ServerToClientEvents, ClientToServerEvents>, roomId: string) {
  const queued = await offlineDb.queue.where("roomId").equals(roomId).sortBy("queuedAt");
  if (queued.length === 0) return 0;

  socket.emit("sync:offline", { roomId, queued }, async (ack) => {
    if ("error" in ack) return;
    await offlineDb.queue.bulkDelete(queued.slice(0, ack.accepted).map((item) => item.id));
  });

  for (const message of queued) {
    socket.emit("message:send", message, () => undefined);
  }

  return queued.length;
}
