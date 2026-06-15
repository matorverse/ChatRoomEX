"use client";

import type { Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@/lib/realtime/events";
import { offlineDb } from "@/lib/offline/db";

export async function flushOfflineQueue(socket: Socket<ServerToClientEvents, ClientToServerEvents>, roomId: string) {
  const queued = await offlineDb.queue.where("roomId").equals(roomId).sortBy("queuedAt");
  if (queued.length === 0) return 0;

  const payload = queued.map((item) => ({
    roomId: item.roomId,
    body: item.body,
    clientNonce: item.clientNonce,
    threadId: item.threadId,
    parentId: item.parentId
  }));

  socket.emit("sync:offline", { roomId, queued: payload }, async (ack) => {
    if ("error" in ack) return;
    
    if (ack.accepted > 0) {
      await offlineDb.queue.bulkDelete(queued.slice(0, ack.accepted).map((item) => item.id));
    }
    
    if (ack.failedNonce) {
      const pending = await offlineDb.messages.where("clientNonce").equals(ack.failedNonce).first();
      if (pending) {
        await offlineDb.messages.update(pending.id, { localState: "failed" });
      }
      await offlineDb.queue.delete(ack.failedNonce);
      
      if (queued.length > ack.accepted + 1) {
        void flushOfflineQueue(socket, roomId);
      }
    }
  });

  return queued.length;
}
