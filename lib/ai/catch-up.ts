import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { ChatMessage } from "@/lib/realtime/events";
import { getClient } from "@/lib/realtime/redis-state";

export const catchUpSummarySchema = z.object({
  bullets: z.tuple([z.string(), z.string(), z.string()]),
  actionItems: z.array(z.string()).default([]),
  sentiment: z.enum(["calm", "positive", "concerned", "urgent", "mixed"])
});

export type CatchUpSummary = z.infer<typeof catchUpSummarySchema>;

const genAI =
  process.env.GOOGLE_CLOUD_PROJECT && process.env.VERTEX_LOCATION
    ? new GoogleGenAI({
        enterprise: true,
        project: process.env.GOOGLE_CLOUD_PROJECT,
        location: process.env.VERTEX_LOCATION
      })
    : null;

function getSummaryCacheParams(messages: ChatMessage[]) {
  if (messages.length === 0) return null;
  const roomId = messages[0].roomId;

  let latestMsg = messages[0];
  for (const msg of messages) {
    if (msg.createdAt > latestMsg.createdAt) {
      latestMsg = msg;
    }
  }

  return {
    roomId,
    length: messages.length,
    lastId: latestMsg.id,
    lastTime: new Date(latestMsg.updatedAt).getTime()
  };
}

export async function summarizeUnread(messages: ChatMessage[]): Promise<CatchUpSummary> {
  if (messages.length <= 50) {
    return {
      bullets: ["Unread volume is low.", "No catch-up summary is needed.", "Open the room to review messages directly."],
      actionItems: [],
      sentiment: "calm"
    };
  }

  const params = getSummaryCacheParams(messages);
  const cacheKey = params
    ? `summary:${params.roomId}:${params.length}:${params.lastId}:${params.lastTime}`
    : null;

  if (cacheKey) {
    try {
      const connection = await getClient();
      if (connection) {
        let cached: string | null = null;
        if (connection.type === "tcp") {
          cached = await connection.client.get(cacheKey);
        } else {
          cached = await connection.client.get(cacheKey);
        }
        if (cached) {
          const parsed = typeof cached === "string" ? JSON.parse(cached) : cached;
          return catchUpSummarySchema.parse(parsed);
        }
      }
    } catch (err) {
      console.error("Failed to read from summary cache", err);
    }
  }

  if (!genAI) {
    const summary = fallbackSummary(messages);
    if (cacheKey) {
      void cacheSummary(cacheKey, summary);
    }
    return summary;
  }

  const result = await genAI.models.generateContent({
    model: "gemini-2.5-flash",
    contents: JSON.stringify({
      task: "Summarize unread chat messages for a mobile catch-up panel.",
      messages: messages.map((message) => ({
        authorId: message.authorId,
        body: message.body.replace(/!\[.*?\]\(.*?\)/g, "[Image]").slice(0, 120),
        createdAt: message.createdAt
      }))
    }),
    config: {
      temperature: 0.2,
      responseMimeType: "application/json",
      systemInstruction:
        "Return strict JSON only with keys bullets, actionItems, sentiment. bullets must contain exactly three concise strings. sentiment must be one of calm, positive, concerned, urgent, mixed."
    }
  });

  try {
    const text = result.text;
    const summary = catchUpSummarySchema.parse(JSON.parse(text ?? "{}"));
    if (cacheKey) {
      void cacheSummary(cacheKey, summary);
    }
    return summary;
  } catch (err) {
    console.error("Failed to parse Gemini summary, falling back to local processing", err);
    const summary = fallbackSummary(messages);
    if (cacheKey) {
      void cacheSummary(cacheKey, summary);
    }
    return summary;
  }
}

export async function streamCatchUp(messages: ChatMessage[], onChunk: (chunk: string) => void) {
  if (!genAI) {
    onChunk(JSON.stringify(fallbackSummary(messages)));
    return;
  }

  const stream = await genAI.models.generateContentStream({
    model: "gemini-2.5-flash",
    contents: JSON.stringify({
      messages: messages.map((message) => ({
        authorId: message.authorId,
        body: message.body.replace(/!\[.*?\]\(.*?\)/g, "[Image]").slice(0, 120),
        createdAt: message.createdAt
      }))
    }),
    config: { temperature: 0.2, responseMimeType: "application/json" }
  });

  for await (const item of stream) {
    const chunk = item.text;
    if (chunk) onChunk(chunk);
  }
}

async function cacheSummary(cacheKey: string, summary: CatchUpSummary) {
  try {
    const connection = await getClient();
    if (connection) {
      if (connection.type === "tcp") {
        await connection.client.set(cacheKey, JSON.stringify(summary), { EX: 10 * 60 });
      } else {
        await connection.client.set(cacheKey, summary, { ex: 10 * 60 });
      }
    }
  } catch (err) {
    console.error("Failed to write to summary cache", err);
  }
}

function fallbackSummary(messages: ChatMessage[]): CatchUpSummary {
  const recent = messages.slice(-50);
  return {
    bullets: [
      `${recent.length} recent unread messages are ready to review.`,
      "The busiest portion appears near the latest messages.",
      "AI summarization will improve when Vertex AI credentials are configured."
    ],
    actionItems: recent
      .filter((message) => /\b(todo|please|need|ship|fix|review)\b/i.test(message.body))
      .slice(0, 5)
      .map((message) => message.body.replace(/!\[.*?\]\(.*?\)/g, "[Image]").slice(0, 120)),
    sentiment: "mixed"
  };
}
