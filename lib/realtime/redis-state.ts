import { Redis } from "@upstash/redis";

let tcpClientPromise: Promise<any> | null = null;
let tcpClient: any = null;
let tcpConnected = false;

const restClient =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN
      })
    : null;

export async function getClient() {
  if (process.env.REDIS_URL) {
    if (!tcpClientPromise) {
      tcpClientPromise = (async () => {
        const { createClient } = await import("redis");
        const client = createClient({ url: process.env.REDIS_URL });
        client.on("error", (err: any) => console.error("Redis TCP Client Error", err));
        await client.connect();
        tcpClient = client;
        tcpConnected = true;
        return client;
      })();
    }
    const client = await tcpClientPromise;
    return { type: "tcp" as const, client };
  }
  if (restClient) {
    return { type: "rest" as const, client: restClient };
  }
  return null;
}

export async function incrementUnreadForRoom(roomId: string, authorId: string, memberIds: string[]) {
  const connection = await getClient();
  if (!connection) return;

  if (connection.type === "tcp") {
    const multi = connection.client.multi();
    for (const userId of memberIds) {
      if (userId !== authorId) {
        multi.hIncrBy(`unread:${userId}`, roomId, 1);
      }
    }
    await multi.exec();
  } else {
    const pipeline = connection.client.pipeline();
    for (const userId of memberIds) {
      if (userId !== authorId) {
        pipeline.hincrby(`unread:${userId}`, roomId, 1);
      }
    }
    await pipeline.exec();
  }
}

export async function clearUnread(userId: string, roomId: string) {
  const connection = await getClient();
  if (!connection) return;
  if (connection.type === "tcp") {
    await connection.client.hDel(`unread:${userId}`, roomId);
  } else {
    await connection.client.hdel(`unread:${userId}`, roomId);
  }
}

export async function setSocketState(sessionId: string, socketId: string, userId: string) {
  const connection = await getClient();
  if (!connection) return;
  const key = `socket:${sessionId}`;
  const data = { socketId, userId, connectedAt: Date.now() };
  if (connection.type === "tcp") {
    await connection.client.set(key, JSON.stringify(data), { EX: 60 * 60 });
  } else {
    await connection.client.set(key, data, { ex: 60 * 60 });
  }
}

export async function clearSocketState(sessionId: string) {
  const connection = await getClient();
  if (!connection) return;
  const key = `socket:${sessionId}`;
  if (connection.type === "tcp") {
    await connection.client.del(key);
  } else {
    await connection.client.del(key);
  }
}

export async function setTypingState(roomId: string, userId: string, isTyping: boolean) {
  const connection = await getClient();
  if (!connection) return;
  const key = `typing:${roomId}`;
  if (isTyping) {
    if (connection.type === "tcp") {
      await connection.client.hSet(key, userId, String(Date.now()));
      await connection.client.expire(key, 8);
    } else {
      await connection.client.hset(key, { [userId]: Date.now() });
      await connection.client.expire(key, 8);
    }
  } else {
    if (connection.type === "tcp") {
      await connection.client.hDel(key, userId);
    } else {
      await connection.client.hdel(key, userId);
    }
  }
}

export interface UserPresence {
  userId: string;
  status: "online" | "offline" | "idle" | "dnd";
  lastSeenAt: string;
  activeSocket: string | null;
}

export async function upsertPresence(
  roomId: string,
  userId: string,
  activeSocket: string | null,
  status: "online" | "offline" | "idle" | "dnd"
): Promise<UserPresence> {
  const connection = await getClient();
  const presenceData: UserPresence = {
    userId,
    status,
    lastSeenAt: new Date().toISOString(),
    activeSocket
  };

  if (connection) {
    const key = `presence:${roomId}`;
    if (connection.type === "tcp") {
      await connection.client.hSet(key, userId, JSON.stringify(presenceData));
    } else {
      await connection.client.hset(key, { [userId]: JSON.stringify(presenceData) });
    }
  }
  return presenceData;
}

export async function getPresence(roomId: string): Promise<UserPresence[]> {
  const connection = await getClient();
  if (!connection) return [];

  const key = `presence:${roomId}`;
  let rawHash: Record<string, string> = {};

  if (connection.type === "tcp") {
    rawHash = await connection.client.hGetAll(key);
  } else {
    rawHash = (await connection.client.hgetall(key)) || {};
  }

  const presences: UserPresence[] = [];
  for (const userId of Object.keys(rawHash)) {
    try {
      const val = rawHash[userId];
      const data = typeof val === "string" ? JSON.parse(val) : val;
      presences.push(data);
    } catch {
      // fallback if parsing fails
    }
  }

  // Sort by lastSeenAt desc, take latest 80
  presences.sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());
  return presences.slice(0, 80);
}

export async function disconnectPresence(
  userId: string,
  socketId: string,
  roomIds: string[]
): Promise<Array<{ roomId: string; presence: UserPresence[] }>> {
  const connection = await getClient();
  if (!connection || roomIds.length === 0) return [];

  const updates: Array<{ roomId: string; presence: UserPresence[] }> = [];

  for (const roomId of roomIds) {
    const key = `presence:${roomId}`;
    let rawStr: any = null;
    if (connection.type === "tcp") {
      rawStr = await connection.client.hGet(key, userId);
    } else {
      rawStr = await connection.client.hget(key, userId);
    }

    if (rawStr) {
      try {
        const presence = typeof rawStr === "string" ? JSON.parse(rawStr) : rawStr;
        if (presence.activeSocket === socketId) {
          presence.activeSocket = null;
          presence.status = "offline";
          presence.lastSeenAt = new Date().toISOString();

          if (connection.type === "tcp") {
            await connection.client.hSet(key, userId, JSON.stringify(presence));
          } else {
            await connection.client.hset(key, { [userId]: JSON.stringify(presence) });
          }

          const fullPresence = await getPresence(roomId);
          updates.push({ roomId, presence: fullPresence });
        }
      } catch (err) {
        console.error("Error updating presence on disconnect", err);
      }
    }
  }
  return updates;
}

export async function getUnreadForRoom(userId: string, roomId: string): Promise<number> {
  const connection = await getClient();
  if (!connection) return 0;
  let val: any = null;
  if (connection.type === "tcp") {
    val = await connection.client.hGet(`unread:${userId}`, roomId);
  } else {
    val = await connection.client.hget(`unread:${userId}`, roomId);
  }
  return val ? parseInt(String(val), 10) || 0 : 0;
}

export async function getAllUnread(userId: string): Promise<Record<string, number>> {
  const connection = await getClient();
  if (!connection) return {};
  let rawHash: Record<string, string> = {};
  if (connection.type === "tcp") {
    rawHash = await connection.client.hGetAll(`unread:${userId}`);
  } else {
    rawHash = (await connection.client.hgetall(`unread:${userId}`)) || {};
  }
  const result: Record<string, number> = {};
  for (const roomId of Object.keys(rawHash)) {
    result[roomId] = parseInt(String(rawHash[roomId]), 10) || 0;
  }
  return result;
}
