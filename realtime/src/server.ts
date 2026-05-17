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

const log = pino({ name: "chatroomex-realtime" });
const prisma = new PrismaClient();
const httpServer = createServer();

const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(httpServer, {
  cors: {
    origin: process.env.WEB_ORIGIN?.split(",") ?? ["http://localhost:3000"],
    credentials: true
  },
  transports: ["websocket", "polling"],
  connectionStateRecovery: {
    maxDisconnectionDuration: 120_000,
    skipMiddlewares: false
  }
});

if (process.env.REDIS_URL) {
  const pubClient = createClient({ url: process.env.REDIS_URL });
  const subClient = pubClient.duplicate();
  await Promise.all([pubClient.connect(), subClient.connect()]);
  io.adapter(createAdapter(pubClient, subClient));
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

io.on("connection", (socket) => {
  log.info({ socketId: socket.id, userId: socket.data.userId }, "socket connected");

  socket.on("room:join", async ({ roomId }, ack) => {
    const member = await authorizeRoom(socket.data.userId, roomId);
    if (!member) {
      ack({ error: "Forbidden" });
      return;
    }

    socket.data.roles.set(roomId, member.role);
    await socket.join(`room:${roomId}`);
    await prisma.roomPresence.upsert({
      where: { roomId_userId: { roomId, userId: socket.data.userId } },
      create: { roomId, userId: socket.data.userId, activeSocket: socket.id, status: "online" },
      update: { activeSocket: socket.id, status: "online", lastSeenAt: new Date() }
    });

    const presence = await prisma.roomPresence.findMany({
      where: { roomId },
      select: { userId: true, status: true, lastSeenAt: true },
      orderBy: { lastSeenAt: "desc" },
      take: 80
    });

    io.to(`room:${roomId}`).emit("presence:update", {
      roomId,
      presence: presence.map((item) => ({
        userId: item.userId,
        status: item.status,
        lastSeenAt: item.lastSeenAt.toISOString()
      }))
    });

    ack({ ok: true });
  });

  socket.on("message:send", async (raw, ack) => {
    const parsed = sendMessageSchema.safeParse(raw);
    if (!parsed.success) {
      ack({ error: "Invalid message" });
      return;
    }

    const input = parsed.data;
    const member = await authorizeRoom(socket.data.userId, input.roomId);
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
  });

  socket.on("typing:set", async (raw) => {
    const parsed = typingSchema.safeParse(raw);
    if (!parsed.success) return;
    if (!socket.rooms.has(`room:${parsed.data.roomId}`)) return;
    socket.to(`room:${parsed.data.roomId}`).emit("typing:update", { ...parsed.data, userId: socket.data.userId });
  });

  socket.on("reaction:toggle", async (raw) => {
    const parsed = reactionSchema.safeParse(raw);
    if (!parsed.success) return;
    const member = await authorizeRoom(socket.data.userId, parsed.data.roomId);
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
      await prisma.reaction.delete({ where: { id: existing.id } });
      io.to(`room:${parsed.data.roomId}`).emit("reaction:update", { ...parsed.data, userId: socket.data.userId, op: "remove" });
    } else {
      await prisma.reaction.create({
        data: { messageId: parsed.data.messageId, userId: socket.data.userId, emoji: parsed.data.emoji }
      });
      io.to(`room:${parsed.data.roomId}`).emit("reaction:update", { ...parsed.data, userId: socket.data.userId, op: "add" });
    }
  });

  socket.on("disconnecting", async () => {
    const roomIds = [...socket.rooms].filter((room) => room.startsWith("room:")).map((room) => room.slice(5));
    await Promise.all(
      roomIds.map((roomId) =>
        prisma.roomPresence.updateMany({
          where: { roomId, userId: socket.data.userId, activeSocket: socket.id },
          data: { status: "offline", lastSeenAt: new Date(), activeSocket: null }
        })
      )
    );
  });
});

const port = Number(process.env.PORT ?? 4000);
httpServer.listen(port, () => {
  log.info({ port }, "realtime server listening");
});
