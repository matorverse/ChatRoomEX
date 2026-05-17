import { Redis } from "@upstash/redis";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN
      })
    : null;

export async function incrementUnreadForRoom(roomId: string, authorId: string, memberIds: string[]) {
  if (!redis) return;

  const pipeline = redis.pipeline();
  for (const userId of memberIds) {
    if (userId !== authorId) {
      pipeline.hincrby(`unread:${userId}`, roomId, 1);
    }
  }
  await pipeline.exec();
}

export async function clearUnread(userId: string, roomId: string) {
  if (!redis) return;
  await redis.hdel(`unread:${userId}`, roomId);
}

export async function setSocketState(sessionId: string, socketId: string, userId: string) {
  if (!redis) return;
  await redis.set(`socket:${sessionId}`, { socketId, userId, connectedAt: Date.now() }, { ex: 60 * 60 });
}

export async function clearSocketState(sessionId: string) {
  if (!redis) return;
  await redis.del(`socket:${sessionId}`);
}

export async function setTypingState(roomId: string, userId: string, isTyping: boolean) {
  if (!redis) return;
  const key = `typing:${roomId}`;
  if (isTyping) {
    await redis.hset(key, { [userId]: Date.now() });
    await redis.expire(key, 8);
  } else {
    await redis.hdel(key, userId);
  }
}
