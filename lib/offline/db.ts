"use client";

import Dexie, { type Table } from "dexie";
import type { ChatMessage, SendMessageInput } from "@/lib/realtime/events";

export type LocalMessage = ChatMessage & {
  localState: "synced" | "pending" | "failed";
};

export type QueuedMessage = SendMessageInput & {
  id: string;
  queuedAt: number;
  attempts: number;
};

class ChatRoomEXDb extends Dexie {
  messages!: Table<LocalMessage, string>;
  queue!: Table<QueuedMessage, string>;
  cursors!: Table<{ roomId: string; updatedAt: string }, string>;

  constructor() {
    super("chatroomex");
    this.version(1).stores({
      messages: "id, roomId, createdAt, localState, clientNonce",
      queue: "id, roomId, queuedAt",
      cursors: "roomId"
    });
  }
}

export const offlineDb = new ChatRoomEXDb();

export async function cacheMessages(messages: ChatMessage[]) {
  await offlineDb.messages.bulkPut(messages.map((message) => ({ ...message, localState: "synced" as const })));
}

export async function enqueueMessage(input: SendMessageInput) {
  const queued: QueuedMessage = {
    ...input,
    id: input.clientNonce,
    queuedAt: Date.now(),
    attempts: 0
  };
  await offlineDb.queue.put(queued);
  return queued;
}

export async function markAcked(clientNonce: string, message: ChatMessage) {
  await offlineDb.transaction("rw", offlineDb.messages, offlineDb.queue, async () => {
    const pending = await offlineDb.messages.where("clientNonce").equals(clientNonce).first();
    if (pending) {
      await offlineDb.messages.delete(pending.id);
    }
    await offlineDb.messages.put({ ...message, localState: "synced" });
    await offlineDb.queue.delete(clientNonce);
  });
}

export async function markFailed(clientNonce: string) {
  const pending = await offlineDb.messages.where("clientNonce").equals(clientNonce).first();
  if (pending) {
    await offlineDb.messages.update(pending.id, { localState: "failed" });
  }
}
