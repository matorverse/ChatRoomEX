import { Redis } from "@upstash/redis";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN
      })
    : null;

export async function fixedWindowRateLimit(key: string, limit: number, windowSeconds: number) {
  if (!redis) {
    return { allowed: true, remaining: limit - 1 };
  }

  const bucket = `rl:${key}:${Math.floor(Date.now() / (windowSeconds * 1000))}`;
  const count = await redis.incr(bucket);

  if (count === 1) {
    await redis.expire(bucket, windowSeconds);
  }

  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count)
  };
}
