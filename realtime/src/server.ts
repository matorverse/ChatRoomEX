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

const activeBattles = new Map<string, {
  id: string;
  challengerId: string;
  defenderId: string;
  challengerHp: number;
  defenderHp: number;
  challengerChoice?: string;
  defenderChoice?: string;
  log: string[];
}>();

async function findUserByHandle(handle: string) {
  return prisma.user.findFirst({
    where: { handle: { equals: handle.toLowerCase().trim(), mode: "insensitive" } }
  });
}

async function getUserRoles(userId: string, roomId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { globalRole: true, displayName: true, handle: true }
  });
  const member = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId } },
    select: { role: true }
  });
  return {
    globalRole: user?.globalRole ?? "user",
    roomRole: member?.role ?? "member",
    displayName: user?.displayName ?? user?.handle ?? "User",
    handle: user?.handle ?? ""
  };
}

function getGlobalRoleWeight(role: string): number {
  if (role === "admin") return 4;
  if (role === "moderator") return 3;
  if (role === "driver") return 2;
  if (role === "voice") return 1;
  return 0; // user
}

function getRoomRoleWeight(role: string): number {
  if (role === "owner") return 5;
  if (role === "admin") return 4;
  if (role === "moderator") return 3;
  if (role === "driver") return 2;
  if (role === "voice") return 1;
  return 0; // member/guest
}

function checkRoleHierarchy(actor: any, target: any, roleName: string, isPromotion: boolean): boolean {
  if (actor.globalRole === "admin") return true;
  
  const targetGlobalWeight = getGlobalRoleWeight(target.globalRole);
  const targetRoomWeight = getRoomRoleWeight(target.roomRole);
  const actorGlobalWeight = getGlobalRoleWeight(actor.globalRole);
  const actorRoomWeight = getRoomRoleWeight(actor.roomRole);
  
  const requestedGlobalWeight = getGlobalRoleWeight(roleName);
  const requestedRoomWeight = getRoomRoleWeight(roleName);
  
  const isGlobalRole = ["admin", "moderator", "driver", "voice", "user"].includes(roleName);
  
  if (isGlobalRole) {
    if (actor.globalRole !== "admin" && actor.globalRole !== "moderator") return false;
    if (actorGlobalWeight <= targetGlobalWeight) return false;
    if (actorGlobalWeight <= requestedGlobalWeight) return false;
    return true;
  } else {
    const canModifyRoomRole = actor.roomRole === "owner" || actor.roomRole === "moderator";
    if (!canModifyRoomRole) return false;
    
    if (actor.roomRole === "owner") {
      return actor.handle !== target.handle;
    }
    
    if (actor.roomRole === "moderator") {
      if (targetRoomWeight >= 3) return false;
      if (requestedRoomWeight >= 3) return false;
      return true;
    }
  }
  return false;
}

async function applyRoleChange(userId: string, roomId: string, roleName: string, isPromotion: boolean) {
  const isGlobalRole = ["admin", "moderator", "driver", "voice", "user"].includes(roleName);
  if (isGlobalRole) {
    await prisma.user.update({
      where: { id: userId },
      data: { globalRole: roleName }
    });
  } else {
    await prisma.roomMember.upsert({
      where: { roomId_userId: { roomId, userId } },
      create: { roomId, userId, role: roleName as any },
      update: { role: roleName as any }
    });
  }
}

async function awardPoints(userId: string, pointsToAdd: number) {
  await prisma.userPoints.upsert({
    where: { userId },
    create: { userId, points: pointsToAdd },
    update: { points: { increment: pointsToAdd } }
  });
}

async function broadcastSystemAlert(roomId: string, body: string, actorId: string) {
  const sysMsg = await prisma.message.create({
    data: { roomId, authorId: actorId, body }
  });
  io.to(`room:${roomId}`).emit("message:new", {
    message: {
      id: sysMsg.id,
      roomId: sysMsg.roomId,
      authorId: sysMsg.authorId,
      body: sysMsg.body,
      threadId: null,
      parentId: null,
      createdAt: sysMsg.createdAt.toISOString(),
      updatedAt: sysMsg.updatedAt.toISOString()
    }
  });
}

async function broadcastLeaderboard() {
  const standings = await prisma.userPoints.findMany({
    orderBy: { points: "desc" },
    take: 20,
    select: {
      points: true,
      user: { select: { id: true, displayName: true } }
    }
  });
  const formatted = standings.map((s) => ({
    userId: s.user.id,
    displayName: s.user.displayName,
    points: s.points
  }));
  io.emit("leaderboard:update", { standings: formatted });
}

async function handleCommand(socket: any, roomId: string, commandStr: string): Promise<{ success: boolean; error?: string }> {
  const parts = commandStr.trim().split(/\s+/);
  const command = parts[0].toLowerCase();
  
  const actor = await getUserRoles(socket.data.userId, roomId);
  
  if (command === "/promote" || command === "/demote") {
    const match = commandStr.match(/^\/(promote|demote)\s+(\S+)(?:\s+to)?\s+(\S+)/i);
    if (!match) return { success: false, error: "Invalid usage. Format: /promote [user] to [role]" };
    const op = match[1].toLowerCase();
    const targetHandle = match[2];
    const roleName = match[3].toLowerCase();
    
    const targetUser = await findUserByHandle(targetHandle);
    if (!targetUser) return { success: false, error: `User "${targetHandle}" not found.` };
    
    const target = await getUserRoles(targetUser.id, roomId);
    
    const allowed = checkRoleHierarchy(actor, target, roleName, op === "promote");
    if (!allowed) return { success: false, error: "Forbidden: You do not have permission to modify this rank." };
    
    await applyRoleChange(targetUser.id, roomId, roleName, op === "promote");
    
    const alertBody = `[PROMOTION] ${targetUser.displayName} was ${op === "promote" ? "promoted" : "demoted"} to ${roleName} by ${actor.displayName}`;
    await broadcastSystemAlert(roomId, alertBody, socket.data.userId);
    return { success: true };
  }
  
  if (command === "/ban") {
    const match = commandStr.match(/^\/ban\s+(\S+)(?:\s+(\d+))?/i);
    if (!match) return { success: false, error: "Invalid usage. Format: /ban [user] [durationDays?]" };
    const targetHandle = match[1];
    const days = match[2] ? parseInt(match[2], 10) : null;
    
    const targetUser = await findUserByHandle(targetHandle);
    if (!targetUser) return { success: false, error: `User "${targetHandle}" not found.` };
    const target = await getUserRoles(targetUser.id, roomId);
    
    const isGlobalAction = actor.globalRole === "admin" || (actor.globalRole === "moderator" && days && days <= 3);
    const isRoomAction = actor.roomRole === "owner";
    
    if (!isGlobalAction && !isRoomAction) {
      return { success: false, error: "Forbidden: You do not have permission to ban this user." };
    }
    
    if (isGlobalAction && target.globalRole === "admin" && actor.globalRole !== "admin") {
      return { success: false, error: "Forbidden: Cannot ban a global admin." };
    }
    
    if (isGlobalAction) {
      const bannedUntil = days ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000);
      await prisma.user.update({
        where: { id: targetUser.id },
        data: { bannedUntil }
      });
      io.to(`user:${targetUser.id}`).disconnectSockets();
      
      const alertBody = `[SYSTEM] ${targetUser.displayName} was banned globally by ${actor.displayName}${days ? ` for ${days} days` : " permanently"}.`;
      await broadcastSystemAlert(roomId, alertBody, socket.data.userId);
    } else {
      const bannedUntil = days ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000);
      await prisma.roomPunishment.upsert({
        where: { roomId_userId_type: { roomId, userId: targetUser.id, type: "ban" } },
        create: { roomId, userId: targetUser.id, type: "ban", expiresAt: bannedUntil },
        update: { expiresAt: bannedUntil }
      });
      
      const targetSockets = io.of("/").sockets;
      for (const [_, ts] of targetSockets) {
        if (ts.data.userId === targetUser.id) {
          ts.leave(`room:${roomId}`);
          ts.emit("message:rollback", { clientNonce: "", reason: "You were banned from this room." });
        }
      }
      
      const alertBody = `[SYSTEM] ${targetUser.displayName} was banned from the room by ${actor.displayName}${days ? ` for ${days} days` : ""}.`;
      await broadcastSystemAlert(roomId, alertBody, socket.data.userId);
    }
    return { success: true };
  }
  
  if (command === "/unban") {
    const match = commandStr.match(/^\/unban\s+(\S+)/i);
    if (!match) return { success: false, error: "Invalid usage. Format: /unban [user]" };
    const targetHandle = match[1];
    
    const targetUser = await findUserByHandle(targetHandle);
    if (!targetUser) return { success: false, error: `User "${targetHandle}" not found.` };
    
    if (actor.globalRole === "admin" || actor.globalRole === "moderator") {
      await prisma.user.update({
        where: { id: targetUser.id },
        data: { bannedUntil: null }
      });
      await broadcastSystemAlert(roomId, `[SYSTEM] ${targetUser.displayName} was globally unbanned by ${actor.displayName}.`, socket.data.userId);
    } else if (actor.roomRole === "owner") {
      await prisma.roomPunishment.deleteMany({
        where: { roomId, userId: targetUser.id, type: "ban" }
      });
      await broadcastSystemAlert(roomId, `[SYSTEM] ${targetUser.displayName} was unbanned from the room by ${actor.displayName}.`, socket.data.userId);
    } else {
      return { success: false, error: "Forbidden: You do not have permission to unban." };
    }
    return { success: true };
  }
  
  if (command === "/mute") {
    const match = commandStr.match(/^\/mute\s+(\S+)(?:\s+(\d+))?/i);
    if (!match) return { success: false, error: "Invalid usage. Format: /mute [user] [durationMinutes?]" };
    const targetHandle = match[1];
    const minutes = match[2] ? parseInt(match[2], 10) : 30;
    
    const targetUser = await findUserByHandle(targetHandle);
    if (!targetUser) return { success: false, error: `User "${targetHandle}" not found.` };
    const target = await getUserRoles(targetUser.id, roomId);
    
    const isGlobalAction = actor.globalRole === "admin" || actor.globalRole === "moderator" || actor.globalRole === "driver";
    const isRoomAction = actor.roomRole === "owner" || actor.roomRole === "moderator";
    
    if (!isGlobalAction && !isRoomAction) {
      return { success: false, error: "Forbidden: You do not have permission to mute." };
    }
    
    const expiresAt = new Date(Date.now() + minutes * 60 * 1000);
    
    if (isGlobalAction) {
      await prisma.user.update({
        where: { id: targetUser.id },
        data: { mutedUntil: expiresAt }
      });
      await broadcastSystemAlert(roomId, `[SYSTEM] ${targetUser.displayName} was muted globally by ${actor.displayName} for ${minutes} minutes.`, socket.data.userId);
    } else {
      await prisma.roomPunishment.upsert({
        where: { roomId_userId_type: { roomId, userId: targetUser.id, type: "mute" } },
        create: { roomId, userId: targetUser.id, type: "mute", expiresAt },
        update: { expiresAt }
      });
      await broadcastSystemAlert(roomId, `[SYSTEM] ${targetUser.displayName} was muted in the room by ${actor.displayName} for ${minutes} minutes.`, socket.data.userId);
    }
    return { success: true };
  }
  
  if (command === "/unmute") {
    const match = commandStr.match(/^\/unmute\s+(\S+)/i);
    if (!match) return { success: false, error: "Invalid usage. Format: /unmute [user]" };
    const targetHandle = match[1];
    
    const targetUser = await findUserByHandle(targetHandle);
    if (!targetUser) return { success: false, error: `User "${targetHandle}" not found.` };
    
    if (actor.globalRole === "admin" || actor.globalRole === "moderator" || actor.globalRole === "driver") {
      await prisma.user.update({
        where: { id: targetUser.id },
        data: { mutedUntil: null }
      });
      await broadcastSystemAlert(roomId, `[SYSTEM] ${targetUser.displayName} was globally unmuted by ${actor.displayName}.`, socket.data.userId);
    } else if (actor.roomRole === "owner" || actor.roomRole === "moderator") {
      await prisma.roomPunishment.deleteMany({
        where: { roomId, userId: targetUser.id, type: "mute" }
      });
      await broadcastSystemAlert(roomId, `[SYSTEM] ${targetUser.displayName} was unmuted in the room by ${actor.displayName}.`, socket.data.userId);
    } else {
      return { success: false, error: "Forbidden: You do not have permission to unmute." };
    }
    return { success: true };
  }
  
  if (command === "/tournament") {
    const subCommand = parts[1]?.toLowerCase();
    
    if (subCommand === "create") {
      const name = parts.slice(2).join(" ") || "Daily Tournament";
      const canCreate = actor.globalRole === "admin" || actor.globalRole === "moderator" || actor.globalRole === "driver" ||
                        actor.roomRole === "owner" || actor.roomRole === "moderator" || actor.roomRole === "driver";
      if (!canCreate) return { success: false, error: "Forbidden: Only staff can create tournaments." };
      
      await prisma.tournament.updateMany({
        where: { roomId, status: "active" },
        data: { status: "cancelled" }
      });
      
      const tournament = await prisma.tournament.create({
        data: { roomId, name, status: "active" }
      });
      
      await broadcastSystemAlert(roomId, `[SYSTEM] Tournament "${name}" was created! Host battles or type '/tournament end' to finish.`, socket.data.userId);
      return { success: true };
    }
    
    if (subCommand === "end") {
      const winnerH = parts[2];
      const secondH = parts[3];
      const thirdH = parts[4];
      
      if (!winnerH) return { success: false, error: "Usage: /tournament end [winner] [second?] [third?]" };
      
      const activeTournament = await prisma.tournament.findFirst({
        where: { roomId, status: "active" }
      });
      if (!activeTournament) return { success: false, error: "No active tournament in this room." };
      
      const canEnd = actor.globalRole === "admin" || actor.globalRole === "moderator" || actor.roomRole === "owner" || actor.roomRole === "moderator";
      if (!canEnd) return { success: false, error: "Forbidden: Only tournament hosts or room mods can end tournaments." };
      
      const winnerUser = await findUserByHandle(winnerH);
      const secondUser = secondH ? await findUserByHandle(secondH) : null;
      const thirdUser = thirdH ? await findUserByHandle(thirdH) : null;
      
      if (winnerUser) await awardPoints(winnerUser.id, 3);
      if (secondUser) await awardPoints(secondUser.id, 2);
      if (thirdUser) await awardPoints(thirdUser.id, 1);
      
      await prisma.tournament.update({
        where: { id: activeTournament.id },
        data: {
          status: "completed",
          winnerId: winnerUser?.id ?? null,
          secondId: secondUser?.id ?? null,
          thirdId: thirdUser?.id ?? null
        }
      });
      
      const winnerName = winnerUser?.displayName ?? winnerH;
      const secondName = secondUser ? secondUser.displayName : (secondH ?? "None");
      const thirdName = thirdUser ? thirdUser.displayName : (thirdH ?? "None");
      
      await broadcastSystemAlert(roomId, `[SYSTEM] Tournament "${activeTournament.name}" ended! 🏆 1st: ${winnerName} (3 pts) • 2nd: ${secondName} (2 pts) • 3rd: ${thirdName} (1 pt)`, socket.data.userId);
      await broadcastLeaderboard();
      return { success: true };
    }
    
    if (subCommand === "forceend") {
      const canForce = actor.globalRole === "admin" || actor.globalRole === "moderator" || actor.roomRole === "owner";
      if (!canForce) return { success: false, error: "Forbidden: Only administrators or room owners can force-end tournaments." };
      
      const activeTournament = await prisma.tournament.findFirst({
        where: { roomId, status: "active" }
      });
      if (!activeTournament) return { success: false, error: "No active tournament to end." };
      
      await prisma.tournament.update({
        where: { id: activeTournament.id },
        data: { status: "cancelled" }
      });
      
      await broadcastSystemAlert(roomId, `[SYSTEM] Tournament "${activeTournament.name}" was forcefully cancelled by ${actor.displayName}.`, socket.data.userId);
      return { success: true };
    }
    
    return { success: false, error: "Usage: /tournament [create|end|forceend]" };
  }
  
  return { success: false, error: `Unknown command: ${command}` };
}

io.on("connection", (socket) => {
  log.info({ socketId: socket.id, userId: socket.data.userId }, "socket connected");
  try {
    void setSocketState(socket.data.sessionId, socket.id, socket.data.userId);
    void socket.join(`user:${socket.data.userId}`);
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

      // Check global ban/mute
      const user = await prisma.user.findUnique({
        where: { id: socket.data.userId },
        select: { bannedUntil: true, mutedUntil: true }
      });

      if (user?.bannedUntil && user.bannedUntil > new Date()) {
        socket.emit("message:rollback", { clientNonce: input.clientNonce, reason: "You are globally banned." });
        ack({ error: "Banned" });
        return;
      }

      if (user?.mutedUntil && user.mutedUntil > new Date()) {
        socket.emit("message:rollback", { clientNonce: input.clientNonce, reason: "You are globally muted." });
        ack({ error: "Muted" });
        return;
      }

      // Check room ban/mute
      const roomPunishment = await prisma.roomPunishment.findFirst({
        where: {
          roomId: input.roomId,
          userId: socket.data.userId,
          expiresAt: { gte: new Date() }
        },
        select: { type: true }
      });

      if (roomPunishment) {
        if (roomPunishment.type === "ban") {
          socket.emit("message:rollback", { clientNonce: input.clientNonce, reason: "You are banned from this room." });
          ack({ error: "Banned" });
          return;
        } else if (roomPunishment.type === "mute") {
          socket.emit("message:rollback", { clientNonce: input.clientNonce, reason: "You are muted in this room." });
          ack({ error: "Muted" });
          return;
        }
      }

      // Intercept Command Commands starting with /
      if (input.body.startsWith("/")) {
        const result = await handleCommand(socket, input.roomId, input.body);
        if (result.success) {
          ack({ accepted: true });
          socket.emit("message:ack", {
            clientNonce: input.clientNonce,
            message: {
              id: crypto.randomUUID(),
              roomId: input.roomId,
              authorId: socket.data.userId,
              body: "", // empty body indicates it was consumed as a command
              threadId: null,
              parentId: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              clientNonce: input.clientNonce
            }
          });
        } else {
          socket.emit("message:rollback", { clientNonce: input.clientNonce, reason: result.error ?? "Failed to execute command." });
          ack({ error: result.error ?? "Command failed" });
        }
        return;
      }

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

  socket.on("pm:send", async ({ receiverId, body }) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: socket.data.userId },
        select: { mutedUntil: true }
      });
      if (user?.mutedUntil && user.mutedUntil > new Date()) return;
      
      const receiver = await prisma.user.findUnique({
        where: { id: receiverId },
        select: { blockPMs: true, globalRole: true }
      });
      if (!receiver) return;
      
      const sender = await prisma.user.findUnique({
        where: { id: socket.data.userId },
        select: { globalRole: true }
      });
      
      if (receiver.blockPMs && sender?.globalRole !== "admin" && sender?.globalRole !== "moderator") {
        return;
      }
      
      const pm = await prisma.privateMessage.create({
        data: {
          senderId: socket.data.userId,
          receiverId,
          body
        }
      });
      
      const payload = {
        id: pm.id,
        senderId: pm.senderId,
        receiverId: pm.receiverId,
        body: pm.body,
        createdAt: pm.createdAt.toISOString()
      };
      
      io.to(`user:${socket.data.userId}`).emit("pm:new", payload);
      io.to(`user:${receiverId}`).emit("pm:new", payload);
    } catch (err) {
      log.error({ err }, "Error in pm:send");
    }
  });

  socket.on("pm:history:get", async ({ otherUserId }, ack) => {
    try {
      const messages = await prisma.privateMessage.findMany({
        where: {
          OR: [
            { senderId: socket.data.userId, receiverId: otherUserId },
            { senderId: otherUserId, receiverId: socket.data.userId }
          ]
        },
        orderBy: { createdAt: "asc" },
        take: 100
      });
      
      ack({
        messages: messages.map((m) => ({
          id: m.id,
          senderId: m.senderId,
          receiverId: m.receiverId,
          body: m.body,
          createdAt: m.createdAt.toISOString()
        }))
      });
    } catch (err) {
      log.error({ err }, "Error in pm:history:get");
      ack({ error: "Failed to fetch PM history" });
    }
  });

  socket.on("pm:admin:inspect", async ({ userId1, userId2 }, ack) => {
    try {
      const actor = await prisma.user.findUnique({
        where: { id: socket.data.userId },
        select: { globalRole: true }
      });
      if (actor?.globalRole !== "admin") {
        ack({ error: "Forbidden" });
        return;
      }
      
      const messages = await prisma.privateMessage.findMany({
        where: {
          OR: [
            { senderId: userId1, receiverId: userId2 },
            { senderId: userId2, receiverId: userId1 }
          ]
        },
        orderBy: { createdAt: "asc" },
        take: 150
      });
      
      ack({
        messages: messages.map((m) => ({
          id: m.id,
          senderId: m.senderId,
          receiverId: m.receiverId,
          body: m.body,
          createdAt: m.createdAt.toISOString()
        }))
      });
    } catch (err) {
      log.error({ err }, "Error in pm:admin:inspect");
      ack({ error: "Failed to inspect PMs" });
    }
  });

  socket.on("challenge:send", async ({ defenderId }, ack) => {
    try {
      const defender = await prisma.user.findUnique({
        where: { id: defenderId },
        select: { blockChallenges: true, displayName: true }
      });
      if (!defender) {
        ack({ error: "Player not found." });
        return;
      }
      if (defender.blockChallenges) {
        ack({ error: "Player is blocking challenges." });
        return;
      }
      
      const challenger = await prisma.user.findUnique({
        where: { id: socket.data.userId },
        select: { displayName: true }
      });
      
      const challengeId = crypto.randomUUID();
      await prisma.battleChallenge.create({
        data: {
          id: challengeId,
          challengerId: socket.data.userId,
          defenderId,
          status: "pending"
        }
      });
      
      io.to(`user:${defenderId}`).emit("challenge:invited", {
        challengeId,
        challengerId: socket.data.userId,
        challengerName: challenger?.displayName ?? "Challenger"
      });
      
      ack({ challengeId });
    } catch (err) {
      log.error({ err }, "Error in challenge:send");
      ack({ error: "Failed to send challenge" });
    }
  });

  socket.on("challenge:respond", async ({ challengeId, action }) => {
    try {
      const challenge = await prisma.battleChallenge.findUnique({
        where: { id: challengeId }
      });
      if (!challenge || challenge.status !== "pending") return;
      
      if (action === "decline") {
        await prisma.battleChallenge.update({
          where: { id: challengeId },
          data: { status: "declined" }
        });
        const payload = {
          challengeId,
          status: "declined",
          challengerId: challenge.challengerId,
          defenderId: challenge.defenderId,
          log: ["Challenge declined by opponent."]
        };
        io.to(`user:${challenge.challengerId}`).emit("challenge:update", payload);
      } else {
        await prisma.battleChallenge.update({
          where: { id: challengeId },
          data: { status: "accepted" }
        });
        
        const battleState = {
          id: challengeId,
          challengerId: challenge.challengerId,
          defenderId: challenge.defenderId,
          challengerHp: 100,
          defenderHp: 100,
          log: ["Battle started! Both players choose moves. HP: 100 each."]
        };
        activeBattles.set(challengeId, battleState);
        
        const payload = {
          challengeId,
          status: "accepted",
          challengerId: challenge.challengerId,
          defenderId: challenge.defenderId,
          log: battleState.log
        };
        io.to(`user:${challenge.challengerId}`).emit("challenge:update", payload);
        io.to(`user:${challenge.defenderId}`).emit("challenge:update", payload);
      }
    } catch (err) {
      log.error({ err }, "Error in challenge:respond");
    }
  });

  socket.on("challenge:turn", async ({ challengeId, choice }) => {
    try {
      const battle = activeBattles.get(challengeId);
      if (!battle) return;
      
      if (socket.data.userId === battle.challengerId) {
        battle.challengerChoice = choice;
      } else if (socket.data.userId === battle.defenderId) {
        battle.defenderChoice = choice;
      }
      
      if (battle.challengerChoice && battle.defenderChoice) {
        const cChoice = battle.challengerChoice;
        const dChoice = battle.defenderChoice;
        
        battle.challengerChoice = undefined;
        battle.defenderChoice = undefined;
        
        let cDamage = 0;
        let dDamage = 0;
        
        if (cChoice === "attack") {
          if (dChoice === "attack") {
            cDamage = Math.floor(Math.random() * 15) + 10;
            dDamage = Math.floor(Math.random() * 15) + 10;
            battle.challengerHp -= dDamage;
            battle.defenderHp -= cDamage;
            battle.log.push(`⚔️ Both players attacked! Challenger takes ${dDamage} DMG, Defender takes ${cDamage} DMG.`);
          } else if (dChoice === "defend") {
            cDamage = Math.floor(Math.random() * 8) + 2;
            battle.defenderHp -= cDamage;
            battle.log.push(`🛡️ Challenger attacked, Defender defended! Defender takes reduced ${cDamage} DMG.`);
          } else {
            const dodgeSuccess = Math.random() > 0.4;
            if (dodgeSuccess) {
              battle.log.push(`💨 Challenger attacked, Defender successfully dodged! 0 DMG.`);
            } else {
              cDamage = Math.floor(Math.random() * 20) + 10;
              battle.defenderHp -= cDamage;
              battle.log.push(`💥 Challenger attacked and Defender failed to dodge! Defender takes ${cDamage} DMG.`);
            }
          }
        } else if (cChoice === "defend") {
          if (dChoice === "attack") {
            dDamage = Math.floor(Math.random() * 8) + 2;
            battle.challengerHp -= dDamage;
            battle.log.push(`🛡️ Defender attacked, Challenger defended! Challenger takes reduced ${dDamage} DMG.`);
          } else if (dChoice === "defend") {
            battle.log.push(`🛡️ Both players chose to defend! Nothing happens.`);
          } else {
            battle.log.push(`💤 Challenger defended while Defender tried to dodge.`);
          }
        } else {
          if (dChoice === "attack") {
            const dodgeSuccess = Math.random() > 0.4;
            if (dodgeSuccess) {
              battle.log.push(`💨 Defender attacked, Challenger successfully dodged! 0 DMG.`);
            } else {
              dDamage = Math.floor(Math.random() * 20) + 10;
              battle.challengerHp -= dDamage;
              battle.log.push(`💥 Defender attacked and Challenger failed to dodge! Challenger takes ${dDamage} DMG.`);
            }
          } else if (dChoice === "defend") {
            battle.log.push(`💤 Challenger tried to dodge while Defender defended.`);
          } else {
            battle.log.push(`💨 Both players tried to dodge!`);
          }
        }
        
        battle.challengerHp = Math.max(0, battle.challengerHp);
        battle.defenderHp = Math.max(0, battle.defenderHp);
        battle.log.push(`HP: Challenger: ${battle.challengerHp} | Defender: ${battle.defenderHp}`);
        
        if (battle.challengerHp <= 0 || battle.defenderHp <= 0) {
          let winnerId = "";
          
          if (battle.challengerHp > battle.defenderHp) {
            winnerId = battle.challengerId;
          } else if (battle.defenderHp > battle.challengerHp) {
            winnerId = battle.defenderId;
          } else {
            winnerId = "draw";
          }
          
          await prisma.battleChallenge.update({
            where: { id: challengeId },
            data: {
              status: "completed",
              winnerId: winnerId !== "draw" ? winnerId : null
            }
          });
          
          const challengerUser = await prisma.user.findUnique({ where: { id: battle.challengerId }, select: { displayName: true } });
          const defenderUser = await prisma.user.findUnique({ where: { id: battle.defenderId }, select: { displayName: true } });
          
          const winnerDisplayName = winnerId === battle.challengerId ? (challengerUser?.displayName ?? "Challenger") : (defenderUser?.displayName ?? "Defender");
          
          if (winnerId === "draw") {
            battle.log.push("Battle ended in a Draw!");
          } else {
            battle.log.push(`🏆 Battle ended! Winner: ${winnerDisplayName}`);
            await awardPoints(winnerId, 1);
            
            const firstActiveRoom = await prisma.room.findFirst({ select: { id: true } });
            if (firstActiveRoom) {
              await broadcastSystemAlert(firstActiveRoom.id, `[SYSTEM] ${challengerUser?.displayName} and ${defenderUser?.displayName} battled! ${winnerDisplayName} won!`, winnerId);
            }
          }
          
          const endPayload = {
            challengeId,
            status: "completed",
            challengerId: battle.challengerId,
            defenderId: battle.defenderId,
            winnerId: winnerId !== "draw" ? winnerId : undefined,
            log: battle.log
          };
          io.to(`user:${battle.challengerId}`).emit("challenge:update", endPayload);
          io.to(`user:${battle.defenderId}`).emit("challenge:update", endPayload);
          
          activeBattles.delete(challengeId);
        } else {
          const updatePayload = {
            challengeId,
            status: "turn_waiting",
            challengerId: battle.challengerId,
            defenderId: battle.defenderId,
            log: battle.log
          };
          io.to(`user:${battle.challengerId}`).emit("challenge:update", updatePayload);
          io.to(`user:${battle.defenderId}`).emit("challenge:update", updatePayload);
        }
      }
    } catch (err) {
      log.error({ err }, "Error in challenge:turn");
    }
  });

  socket.on("settings:update", async ({ blockChallenges, blockPMs, customAvatarUrl, avatarUrl }, ack) => {
    try {
      await prisma.user.update({
        where: { id: socket.data.userId },
        data: {
          blockChallenges,
          blockPMs,
          customAvatarUrl: customAvatarUrl || null,
          avatarUrl: avatarUrl || null
        }
      });
      ack({ ok: true });
    } catch (err) {
      log.error({ err }, "Error in settings:update");
      ack({ error: "Failed to update settings" });
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
