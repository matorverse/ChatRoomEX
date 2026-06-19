"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  ChatMessage,
  ClientToServerEvents,
  SendMessageInput,
  ServerToClientEvents,
  TypingInput,
  PresenceState
} from "@/lib/realtime/events";
import { enqueueMessage, markAcked, markFailed, offlineDb } from "@/lib/offline/db";
import { flushOfflineQueue } from "@/lib/offline/sync";

type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function useChatSocket(roomId: string, currentUserId: string, accessToken: string, initialMessages: ChatMessage[]) {
  const [messages, setMessages] = useState(() => initialMessages);
  const [connected, setConnected] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Record<string, number>>({});
  const [presence, setPresence] = useState<PresenceState[]>([]);
  const [reactions, setReactions] = useState<Record<string, Record<string, string[]>>>({});
  const [readReceipts, setReadReceipts] = useState<Record<string, string[]>>({});
  const [pms, setPms] = useState<any[]>([]);
  const [activeChallenge, setActiveChallenge] = useState<any | null>(null);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const socketRef = useRef<ChatSocket | null>(null);
  const isFirstConnectRef = useRef(true);

  useEffect(() => {
    setMessages(initialMessages);
  }, [roomId, initialMessages]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setTypingUsers((current) => {
        let changed = false;
        const next = { ...current };
        for (const [userId, expiresAt] of Object.entries(next)) {
          if (expiresAt <= now) {
            delete next[userId];
            changed = true;
          }
        }
        return changed ? next : current;
      });
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let mounted = true;

    offlineDb.messages
      .where("roomId")
      .equals(roomId)
      .reverse()
      .limit(200)
      .sortBy("createdAt")
      .then(async (cached) => {
        if (mounted && cached.length > 0) {
          setMessages(cached.reverse());
        }

        try {
          const allRoomMessages = await offlineDb.messages
            .where("roomId")
            .equals(roomId)
            .sortBy("createdAt");
          if (allRoomMessages.length > 200) {
            const toDelete = allRoomMessages.slice(0, allRoomMessages.length - 200);
            await offlineDb.messages.bulkDelete(toDelete.map((m) => m.id));
          }
        } catch (err) {
          console.error("Failed to prune IndexedDB messages", err);
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

    const isFirst = isFirstConnectRef.current;
    isFirstConnectRef.current = false;

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("room:join", { roomId }, () => undefined);
      void flushOfflineQueue(socket, roomId);

      if (!isFirst) {
        fetch(`/api/rooms/${roomId}/messages?limit=50`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        })
          .then((res) => res.json())
          .then((data) => {
            if (data.messages && Array.isArray(data.messages)) {
              setMessages((current) => reconcileMessages(current, data.messages));
              void offlineDb.messages.bulkPut(
                data.messages.map((message: any) => ({ ...message, localState: "synced" as const }))
              );
            }
          })
          .catch((err) => console.error("Failed to fetch missed messages on reconnect", err));
      }
    });

    socket.on("disconnect", () => setConnected(false));

    socket.on("message:new", async ({ message }) => {
      setMessages((current) => [...current, message]);
      await offlineDb.messages.put({ ...message, localState: "synced" });
    });

    socket.on("message:batch", async ({ messages: batch }) => {
      const syncedBatch = batch.map((m) => ({ ...m, localState: "synced" as const }));
      setMessages((current) => reconcileMessages(current, syncedBatch));
      const nonces = batch.map((m) => m.clientNonce).filter(Boolean) as string[];
      await offlineDb.transaction("rw", offlineDb.messages, offlineDb.queue, async () => {
        if (nonces.length > 0) {
          const pending = await offlineDb.messages.where("clientNonce").anyOf(nonces).toArray();
          if (pending.length > 0) {
            await offlineDb.messages.bulkDelete(pending.map((m) => m.id));
          }
          await offlineDb.queue.bulkDelete(nonces);
        }
        await offlineDb.messages.bulkPut(syncedBatch);
      });
    });

    socket.on("message:ack", async ({ clientNonce, message }) => {
      setMessages((current) =>
        current.map((item) => (item.clientNonce === clientNonce ? { ...message, localState: "synced" as const } : item))
      );
      await markAcked(clientNonce, message);
    });

    socket.on("message:rollback", async ({ clientNonce }) => {
      setMessages((current) =>
        current.map((item) => (item.clientNonce === clientNonce ? { ...item, localState: "failed" as const } : item))
      );
      await markFailed(clientNonce);
    });

    socket.on("typing:update", ({ userId, isTyping }) => {
      setTypingUsers((current) => {
        const next = { ...current };
        if (isTyping) {
          next[userId] = Date.now() + 8000;
        } else {
          delete next[userId];
        }
        return next;
      });
    });

    socket.on("presence:update", ({ presence }) => {
      setPresence(presence);
    });

    socket.on("reaction:update", ({ messageId, emoji, userId, op }) => {
      setReactions((current) => {
        const next = { ...current };
        if (!next[messageId]) next[messageId] = {};
        if (!next[messageId][emoji]) next[messageId][emoji] = [];
        if (op === "add" && !next[messageId][emoji].includes(userId)) {
          next[messageId][emoji] = [...next[messageId][emoji], userId];
        } else if (op === "remove") {
          next[messageId][emoji] = next[messageId][emoji].filter(id => id !== userId);
        }
        return next;
      });
    });

    socket.on("read:receipt", ({ messageId, userId }) => {
      setReadReceipts((current) => {
        const next = { ...current };
        if (!next[messageId]) next[messageId] = [];
        if (!next[messageId].includes(userId)) {
          next[messageId] = [...next[messageId], userId];
          return next;
        }
        return current;
      });
    });

    socket.on("read:receipt:batch", ({ messageIds, userId }) => {
      setReadReceipts((current) => {
        const next = { ...current };
        let changed = false;
        for (const messageId of messageIds) {
          if (!next[messageId]) {
            next[messageId] = [];
          }
          if (!next[messageId].includes(userId)) {
            next[messageId] = [...next[messageId], userId];
            changed = true;
          }
        }
        return changed ? next : current;
      });
    });
    socket.on("pm:new", (payload) => {
      setPms((current) => [...current, payload]);
    });

    socket.on("challenge:invited", (payload) => {
      setActiveChallenge({
        challengeId: payload.challengeId,
        challengerId: payload.challengerId,
        challengerName: payload.challengerName,
        status: "pending",
        log: ["You have been challenged to a Battle!"]
      });
    });

    socket.on("challenge:update", (payload) => {
      setActiveChallenge((current: any) => {
        if (!current || current.challengeId === payload.challengeId) {
          return {
            challengeId: payload.challengeId,
            challengerId: payload.challengerId,
            defenderId: payload.defenderId,
            status: payload.status,
            winnerId: payload.winnerId,
            log: payload.log
          };
        }
        return current;
      });
    });

    socket.on("leaderboard:update", ({ standings }) => {
      setLeaderboard(standings);
    });

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [accessToken, roomId]);

  const activeTypingUsers = useMemo(() => {
    const now = Date.now();
    return Object.entries(typingUsers)
      .filter(([_, expiresAt]) => expiresAt > now)
      .map(([userId]) => userId)
      .slice(0, 4);
  }, [typingUsers]);

  const sendMessage = useCallback(
    async (body: string, threadId?: string, parentId?: string) => {
      const isCommand = body.startsWith("/") && !body.startsWith("/shrug") && !body.startsWith("/me ");
      if (isCommand) {
        socketRef.current?.emit("message:send", { roomId, body, clientNonce: crypto.randomUUID(), threadId, parentId }, () => undefined);
        return;
      }

      const clientNonce = crypto.randomUUID();
      const optimistic: ChatMessage & { localState?: "pending" | "synced" | "failed" } = {
        id: crypto.randomUUID(),
        roomId,
        authorId: currentUserId,
        body,
        threadId: threadId ?? null,
        parentId: parentId ?? null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        clientNonce,
        localState: "pending"
      };
      const input: SendMessageInput = { roomId, body, clientNonce, threadId, parentId };

      setMessages((current) => [...current, optimistic]);
      await offlineDb.messages.put({ ...optimistic, localState: "pending" });
      await enqueueMessage(input);

      socketRef.current?.emit("message:send", input, () => undefined);
    },
    [roomId, currentUserId]
  );

  const setTyping = useCallback(
    (input: Omit<TypingInput, "roomId">) => socketRef.current?.emit("typing:set", { roomId, ...input }),
    [roomId]
  );

  const toggleReaction = useCallback(
    (messageId: string, emoji: string) => socketRef.current?.emit("reaction:toggle", { roomId, messageId, emoji }),
    [roomId]
  );

  const markReadBatch = useCallback(
    (messageIds: string[]) => socketRef.current?.emit("read:mark:batch", { roomId, messageIds }),
    [roomId]
  );

  const sendPM = useCallback((receiverId: string, body: string) => {
    socketRef.current?.emit("pm:send", { receiverId, body });
  }, []);

  const getPMHistory = useCallback((otherUserId: string): Promise<any[]> => {
    return new Promise((resolve) => {
      socketRef.current?.emit("pm:history:get", { otherUserId }, (res: any) => {
        if (res && "messages" in res) {
          resolve(res.messages);
        } else {
          resolve([]);
        }
      });
    });
  }, []);

  const inspectPMHistory = useCallback((userId1: string, userId2: string): Promise<any[]> => {
    return new Promise((resolve) => {
      socketRef.current?.emit("pm:admin:inspect", { userId1, userId2 }, (res: any) => {
        if (res && "messages" in res) {
          resolve(res.messages);
        } else {
          resolve([]);
        }
      });
    });
  }, []);

  const sendChallenge = useCallback((defenderId: string): Promise<string | null> => {
    return new Promise((resolve) => {
      socketRef.current?.emit("challenge:send", { defenderId }, (res: any) => {
        if (res && "challengeId" in res) {
          setActiveChallenge({
            challengeId: res.challengeId,
            challengerId: currentUserId,
            defenderId,
            status: "pending",
            log: ["Challenge sent. Waiting for response..."]
          });
          resolve(res.challengeId);
        } else {
          resolve(null);
        }
      });
    });
  }, [currentUserId]);

  const respondChallenge = useCallback((challengeId: string, action: "accept" | "decline") => {
    socketRef.current?.emit("challenge:respond", { challengeId, action });
    if (action === "decline") {
      setActiveChallenge(null);
    }
  }, []);

  const makeChallengeTurn = useCallback((challengeId: string, choice: "attack" | "defend" | "dodge") => {
    socketRef.current?.emit("challenge:turn", { challengeId, choice });
  }, []);

  const updateSettings = useCallback((blockChallenges: boolean, blockPMs: boolean, customAvatarUrl?: string, avatarUrl?: string) => {
    return new Promise<boolean>((resolve) => {
      socketRef.current?.emit("settings:update", { blockChallenges, blockPMs, customAvatarUrl, avatarUrl }, (res: any) => {
        resolve(res && "ok" in res);
      });
    });
  }, []);

  const api = useMemo(
    () => ({
      connected,
      messages,
      typingUsers: activeTypingUsers,
      presence,
      reactions,
      readReceipts,
      pms,
      activeChallenge,
      leaderboard,
      sendMessage,
      setTyping,
      toggleReaction,
      markReadBatch,
      sendPM,
      getPMHistory,
      inspectPMHistory,
      sendChallenge,
      respondChallenge,
      makeChallengeTurn,
      updateSettings
    }),
    [
      connected,
      messages,
      activeTypingUsers,
      presence,
      reactions,
      readReceipts,
      pms,
      activeChallenge,
      leaderboard,
      sendMessage,
      setTyping,
      toggleReaction,
      markReadBatch,
      sendPM,
      getPMHistory,
      inspectPMHistory,
      sendChallenge,
      respondChallenge,
      makeChallengeTurn,
      updateSettings
    ]
  );

  return api;
}

function reconcileMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const nonceMap = new Map<string, ChatMessage>();
  const idMap = new Map<string, ChatMessage>();

  for (const msg of current) {
    if (msg.clientNonce) {
      nonceMap.set(msg.clientNonce, msg);
    }
    idMap.set(msg.id, msg);
  }

  for (const msg of incoming) {
    if (msg.clientNonce && nonceMap.has(msg.clientNonce)) {
      const oldMsg = nonceMap.get(msg.clientNonce)!;
      idMap.delete(oldMsg.id);
    }
    idMap.set(msg.id, msg);
  }

  return [...idMap.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
