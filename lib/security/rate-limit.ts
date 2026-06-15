import { getClient } from "@/lib/realtime/redis-state";

export async function fixedWindowRateLimit(key: string, limit: number, windowSeconds: number) {
  const connection = await getClient();
  if (!connection) {
    return { allowed: true, remaining: limit - 1 };
  }

  const bucket = `rl:${key}:${Math.floor(Date.now() / (windowSeconds * 1000))}`;
  let count = 0;

  if (connection.type === "tcp") {
    count = await connection.client.incr(bucket);
    if (count === 1) {
      await connection.client.expire(bucket, windowSeconds);
    }
  } else {
    count = await connection.client.incr(bucket);
    if (count === 1) {
      await connection.client.expire(bucket, windowSeconds);
    }
  }

  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count)
  };
}
