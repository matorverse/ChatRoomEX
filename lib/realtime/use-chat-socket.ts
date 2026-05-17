"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  ChatMessage,
  ClientToServerEvents,
  SendMessageInput,
  ServerToClientEvents,
  TypingInput
} from "@/lib/realtime/events";
import { enqueueMessage, markAcked, markFailed, offlineDb } from "@/lib/offline/db";
import { flushOfflineQueue } from "@/lib/offline/sync";

type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function useChatSocket(roomId: string, currentUserId: string, accessToken: string, initialMessages: ChatMessage[]) {
  const [messages, setMessages] = useState(() => initialMessages);
  const [connected, setConnected] = useState(false);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const socketRef = useRef<ChatSocket | null>(null);

  useEffect(() => {
    let mounted = true;

    offlineDb.messages
      .where("roomId")
      .equals(roomId)
      .sortBy("createdAt")
      .then((cached) => {
        if (mounted && cached.length > initialMessages.length) {
          setMessages(cached);
        }
      });

    return () => {
      mounted = false;
    };
  }, [initialMessages.length, roomId]);

  useEffect(() => {
    const socket: ChatSocket = io(process.env.NEXT_PUBLIC_REALTIME_URL ?? "http://localhost:4000", {
      auth: { token: accessToken },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("room:join", { roomId }, () => undefined);
      void flushOfflineQueue(socket, roomId);
    });

    socket.on("disconnect", () => setConnected(false));

    socket.on("message:new", async ({ message }) => {
      setMessages((current) => [...current, message]);
      await offlineDb.messages.put({ ...message, localState: "synced" });
    });

    socket.on("message:batch", async ({ messages: batch }) => {
      setMessages((current) => reconcileMessages(current, batch));
      await offlineDb.messages.bulkPut(batch.map((message) => ({ ...message, localState: "synced" as const })));
    });

    socket.on("message:ack", async ({ clientNonce, message }) => {
      setMessages((current) => current.map((item) => (item.clientNonce === clientNonce ? message : item)));
      await markAcked(clientNonce, message);
    });

    socket.on("message:rollback", async ({ clientNonce }) => {
      setMessages((current) => current.filter((item) => item.clientNonce !== clientNonce));
      await markFailed(clientNonce);
    });

    socket.on("typing:update", ({ userId, isTyping }) => {
      setTypingUsers((current) => {
        const next = new Set(current);
        if (isTyping) next.add(userId);
        else next.delete(userId);
        return [...next].slice(0, 4);
      });
    });

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [accessToken, roomId]);

  const api = useMemo(
    () => ({
      connected,
      messages,
      typingUsers,
      sendMessage: async (body: string, threadId?: string, parentId?: string) => {
        const clientNonce = crypto.randomUUID();
        const optimistic: ChatMessage = {
          id: crypto.randomUUID(),
          roomId,
          authorId: currentUserId,
          body,
          threadId: threadId ?? null,
          parentId: parentId ?? null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          clientNonce
        };
        const input: SendMessageInput = { roomId, body, clientNonce, threadId, parentId };

        setMessages((current) => [...current, optimistic]);
        await offlineDb.messages.put({ ...optimistic, localState: "pending" });
        await enqueueMessage(input);

        socketRef.current?.emit("message:send", input, () => undefined);
      },
      setTyping: (input: Omit<TypingInput, "roomId">) => socketRef.current?.emit("typing:set", { roomId, ...input })
    }),
    [connected, currentUserId, messages, roomId, typingUsers]
  );

  return api;
}

function reconcileMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const map = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    map.set(message.id, message);
  }
  return [...map.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
