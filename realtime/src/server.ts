import { createServer } from "node:http";
import { createAdapter } from "@socket.io/redis-adapter";
import { PrismaClient } from "@prisma/client";
import { createClient } from "redis";
import { Server } from "socket.io";
import pino from "pino";
import {
  type ClientToServerEvents,
  type InterServerEvents,
  type ServerToClientEvents,
  type SocketData,
  sendMessageSchema,
  typingSchema,
  reactionSchema
} from "../../lib/realtime/events";
import { verifyAccessToken } from "../../lib/auth/jwt";
import { moderateMessage } from "../../lib/security/moderation";
import { fixedWindowRateLimit } from "../../lib/security/rate-limit";
import { auditLog } from "../../lib/security/audit";
import {
  clearSocketState,
  clearUnread,
  incrementUnreadForRoom,
  setSocketState,
  setTypingState,
  upsertPresence,
  getPresence,
  disconnectPresence
} from "../../lib/realtime/redis-state";

const log = pino({ name: "chatroomex-realtime" });
const prisma = new PrismaClient();
const httpServer = createServer();

const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(httpServer, {
  cors: {
    origin: "*",
    credentials: true
  },
  transports: ["websocket", "polling"],
  connectionStateRecovery: {
    maxDisconnectionDuration: 120_000,
    skipMiddlewares: false
  }
});

if (process.env.REDIS_URL) {
  try {
    const pubClient = createClient({ url: process.env.REDIS_URL });
    const subClient = pubClient.duplicate();
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    log.info("Redis adapter configured successfully");
  } catch (err) {
    log.error({ err }, "Failed to connect to Redis. Falling back to memory adapter.");
  }
}

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token ?? socket.handshake.headers.authorization?.replace("Bearer ", "");
    if (!token || typeof token !== "string") {
      throw new Error("Missing token");
    }

    const claims = await verifyAccessToken(token);
    socket.data.userId = claims.sub;
    socket.data.sessionId = claims.sid;
    socket.data.roles = new Map();
    next();
  } catch (error) {
    next(error instanceof Error ? error : new Error("Unauthorized"));
  }
});

async function authorizeRoom(userId: string, roomId: string) {
  const member = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId } },
    select: { role: true, canPost: true, canReact: true, canModerate: true }
  });

  return member;
}

async function authorizeRoomCached(socket: any, roomId: string) {
  if (!socket.data.permissions) {
    socket.data.permissions = new Map();
  }
  const now = Date.now();
  const cached = socket.data.permissions.get(roomId);
  if (cached && now - cached.timestamp < 30000) {
    return cached.member;
  }
  const member = await authorizeRoom(socket.data.userId, roomId);
  if (member) {
    socket.data.permissions.set(roomId, { member, timestamp: now });
  } else {
    socket.data.permissions.delete(roomId);
  }
  return member;
}

io.on("connection", (socket) => {
  log.info({ socketId: socket.id, userId: socket.data.userId }, "socket connected");
  try {
    void setSocketState(socket.data.sessionId, socket.id, socket.data.userId);
  } catch (err) {
    log.error({ err, userId: socket.data.userId }, "Failed to set socket state on connection");
  }

  socket.on("room:join", async ({ roomId }, ack) => {
    try {
      const member = await authorizeRoomCached(socket, roomId);
      if (!member) {
        ack({ error: "Forbidden" });
        return;
      }

      socket.data.roles.set(roomId, member.role);
      await socket.join(`room:${roomId}`);
      await upsertPresence(roomId, socket.data.userId, socket.id, "online");
      const presence = await getPresence(roomId);

      io.to(`room:${roomId}`).emit("presence:update", {
        roomId,
        presence: presence.map((item) => ({
          userId: item.userId,
          status: item.status,
          lastSeenAt: item.lastSeenAt
        }))
      });

      ack({ ok: true });
    } catch (err) {
      log.error({ err, roomId, userId: socket.data.userId }, "Error in room:join handler");
      ack({ error: "Internal server error" });
    }
  });

  socket.on("message:send", async (raw, ack) => {
    try {
      const parsed = sendMessageSchema.safeParse(raw);
      if (!parsed.success) {
        ack({ error: "Invalid message" });
        return;
      }

      const input = parsed.data;
      const member = await authorizeRoomCached(socket, input.roomId);
      if (!member?.canPost) {
        socket.emit("message:rollback", { clientNonce: input.clientNonce, reason: "You cannot post in this room." });
        ack({ error: "Forbidden" });
        return;
      }

      const rate = await fixedWindowRateLimit(`message:${socket.data.userId}`, 20, 30);
      const moderation = moderateMessage(input.body);
      if (!rate.allowed || !moderation.allowed) {
        socket.emit("message:rollback", {
          clientNonce: input.clientNonce,
          reason: moderation.reason ?? "Slow down before sending more messages."
        });
        ack({ error: "Rejected" });
        return;
      }

      const message = await prisma.message.create({
        data: {
          roomId: input.roomId,
          authorId: socket.data.userId,
          body: moderation.normalized,
          clientNonce: input.clientNonce,
          threadId: input.threadId,
          parentId: input.parentId
        }
      });

      const payload = {
        id: message.id,
        roomId: message.roomId,
        authorId: message.authorId,
        body: message.body,
        threadId: message.threadId,
        parentId: message.parentId,
        createdAt: message.createdAt.toISOString(),
        updatedAt: message.updatedAt.toISOString(),
        clientNonce: input.clientNonce
      };

      socket.emit("message:ack", { clientNonce: input.clientNonce, message: payload });
      socket.to(`room:${input.roomId}`).emit("message:new", { message: payload });
      ack({ accepted: true });

      setImmediate(async () => {
        try {
          const members = await prisma.roomMember.findMany({
            where: { roomId: input.roomId },
            select: { userId: true }
          });
          await incrementUnreadForRoom(input.roomId, socket.data.userId, members.map((member) => member.userId));
        } catch (err) {
          log.error({ err }, "Failed to increment unread counts");
        }
      });
    } catch (err) {
      log.error({ err, userId: socket.data.userId }, "Error in message:send handler");
      ack({ error: "Internal server error" });
    }
  });

  socket.on("typing:set", async (raw) => {
    try {
      const parsed = typingSchema.safeParse(raw);
      if (!parsed.success) return;
      if (!socket.rooms.has(`room:${parsed.data.roomId}`)) return;
      await setTypingState(parsed.data.roomId, socket.data.userId, parsed.data.isTyping);
      socket.to(`room:${parsed.data.roomId}`).emit("typing:update", { ...parsed.data, userId: socket.data.userId });
    } catch (err) {
      log.error({ err, userId: socket.data.userId }, "Error in typing:set handler");
    }
  });

  socket.on("reaction:toggle", async (raw) => {
    try {
      const parsed = reactionSchema.safeParse(raw);
      if (!parsed.success) return;
      const member = await authorizeRoomCached(socket, parsed.data.roomId);
      if (!member?.canReact) return;

      const existing = await prisma.reaction.findUnique({
        where: {
          messageId_userId_emoji: {
            messageId: parsed.data.messageId,
            userId: socket.data.userId,
            emoji: parsed.data.emoji
          }
        }
      });

      if (existing) {
        try {
          await prisma.reaction.delete({ where: { id: existing.id } });
          io.to(`room:${parsed.data.roomId}`).emit("reaction:update", { ...parsed.data, userId: socket.data.userId, op: "remove" });
          void auditLog({ actorId: socket.data.userId, roomId: parsed.data.roomId, action: "reaction.removed", metadata: parsed.data });
        } catch (err: any) {
          if (err.code !== 'P2025') console.error(err);
        }
      } else {
        try {
          await prisma.reaction.create({
            data: { messageId: parsed.data.messageId, userId: socket.data.userId, emoji: parsed.data.emoji }
          });
          io.to(`room:${parsed.data.roomId}`).emit("reaction:update", { ...parsed.data, userId: socket.data.userId, op: "add" });
          void auditLog({ actorId: socket.data.userId, roomId: parsed.data.roomId, action: "reaction.added", metadata: parsed.data });
        } catch (err: any) {
          if (err.code !== 'P2002') console.error(err);
        }
      }
    } catch (err) {
      log.error({ err, userId: socket.data.userId }, "Error in reaction:toggle handler");
    }
  });

  socket.on("read:mark:batch", async ({ roomId, messageIds }) => {
    try {
      const member = await authorizeRoomCached(socket, roomId);
      if (!member || messageIds.length === 0) return;

      const readAt = new Date();
      await prisma.readReceipt.createMany({
        data: messageIds.map(id => ({ roomId, userId: socket.data.userId, messageId: id, readAt })),
        skipDuplicates: true
      });
      
      await clearUnread(socket.data.userId, roomId);
      
      io.to(`room:${roomId}`).emit("read:receipt:batch", {
        roomId,
        userId: socket.data.userId,
        messageIds,
        readAt: readAt.toISOString()
      });
    } catch (err) {
      log.error({ err, roomId, userId: socket.data.userId }, "Error in read:mark:batch handler");
    }
  });

  socket.on("sync:offline", async ({ roomId, queued }, ack) => {
    try {
      const member = await authorizeRoomCached(socket, roomId);
      if (!member?.canPost) {
        ack({ error: "Forbidden" });
        return;
      }

      const processed = [];
      let failedNonce: string | undefined = undefined;
      let rollbackReason: string | undefined = undefined;

      for (const input of queued) {
        const rate = await fixedWindowRateLimit(`message:${socket.data.userId}`, 20, 30);
        if (!rate.allowed) {
          break;
        }
        const moderation = moderateMessage(input.body);
        if (!moderation.allowed) {
          failedNonce = input.clientNonce;
          rollbackReason = moderation.reason ?? "Message did not pass room safety filters.";
          socket.emit("message:rollback", { clientNonce: failedNonce, reason: rollbackReason });
          break;
        }
        processed.push({
          roomId,
          authorId: socket.data.userId,
          body: moderation.normalized,
          clientNonce: input.clientNonce,
          threadId: input.threadId ?? null,
          parentId: input.parentId ?? null
        });
      }

      if (processed.length > 0) {
        try {
          const messages = await prisma.$transaction(
            processed.map((data) => prisma.message.create({ data }))
          );

          const payloads = messages.map((message) => ({
            id: message.id,
            roomId: message.roomId,
            authorId: message.authorId,
            body: message.body,
            threadId: message.threadId,
            parentId: message.parentId,
            createdAt: message.createdAt.toISOString(),
            updatedAt: message.updatedAt.toISOString(),
            clientNonce: message.clientNonce ?? undefined
          }));

          io.to(`room:${roomId}`).emit("message:batch", { messages: payloads });

          setImmediate(async () => {
            try {
              const members = await prisma.roomMember.findMany({
                where: { roomId },
                select: { userId: true }
              });
              await incrementUnreadForRoom(roomId, socket.data.userId, members.map((m) => m.userId));
            } catch (err) {
              log.error({ err }, "Failed to increment unread counts for offline sync");
            }
          });

          ack({ accepted: processed.length, failedNonce, rollbackReason });
        } catch (err) {
          log.error({ err }, "Failed to sync offline messages in transaction");
          ack({ error: "Database transaction failed" });
        }
      } else {
        ack({ accepted: 0, failedNonce, rollbackReason });
      }
    } catch (err) {
      log.error({ err, roomId, userId: socket.data.userId }, "Error in sync:offline handler");
      ack({ error: "Internal server error" });
    }
  });

  socket.on("disconnecting", async () => {
    try {
      const roomIds = [...socket.rooms].filter((room) => room.startsWith("room:")).map((room) => room.slice(5));
      const updates = await disconnectPresence(socket.data.userId, socket.id, roomIds);
      for (const update of updates) {
        io.to(`room:${update.roomId}`).emit("presence:update", {
          roomId: update.roomId,
          presence: update.presence.map((item) => ({
            userId: item.userId,
            status: item.status,
            lastSeenAt: item.lastSeenAt
          }))
        });
      }
    } catch (err) {
      log.error({ err, userId: socket.data.userId }, "Failed to update presence on disconnect");
    }
    try {
      void clearSocketState(socket.data.sessionId);
    } catch (err) {
      log.error({ err, userId: socket.data.userId }, "Failed to clear socket state on disconnect");
    }
  });
});

const port = Number(process.env.PORT ?? 4000);
httpServer.listen(port, () => {
  log.info({ port }, "realtime server listening");
});
