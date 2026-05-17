import { VertexAI } from "@google-cloud/vertexai";
import { z } from "zod";
import type { ChatMessage } from "@/lib/realtime/events";

export const catchUpSummarySchema = z.object({
  bullets: z.tuple([z.string(), z.string(), z.string()]),
  actionItems: z.array(z.string()).default([]),
  sentiment: z.enum(["calm", "positive", "concerned", "urgent", "mixed"])
});

export type CatchUpSummary = z.infer<typeof catchUpSummarySchema>;

const vertex =
  process.env.GOOGLE_CLOUD_PROJECT && process.env.VERTEX_LOCATION
    ? new VertexAI({
        project: process.env.GOOGLE_CLOUD_PROJECT,
        location: process.env.VERTEX_LOCATION
      })
    : null;

export async function summarizeUnread(messages: ChatMessage[]): Promise<CatchUpSummary> {
  if (messages.length <= 50) {
    return {
      bullets: ["Unread volume is low.", "No catch-up summary is needed.", "Open the room to review messages directly."],
      actionItems: [],
      sentiment: "calm"
    };
  }

  if (!vertex) {
    return fallbackSummary(messages);
  }

  const model = vertex.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json"
    },
    systemInstruction:
      "Return strict JSON only with keys bullets, actionItems, sentiment. bullets must contain exactly three concise strings. sentiment must be one of calm, positive, concerned, urgent, mixed."
  });

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          {
            text: JSON.stringify({
              task: "Summarize unread chat messages for a mobile catch-up panel.",
              messages: messages.map((message) => ({
                authorId: message.authorId,
                body: message.body,
                createdAt: message.createdAt
              }))
            })
          }
        ]
      }
    ]
  });

  const text = result.response.candidates?.[0]?.content.parts?.[0]?.text;
  return catchUpSummarySchema.parse(JSON.parse(text ?? "{}"));
}

export async function streamCatchUp(messages: ChatMessage[], onChunk: (chunk: string) => void) {
  if (!vertex) {
    onChunk(JSON.stringify(fallbackSummary(messages)));
    return;
  }

  const model = vertex.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
  });

  const stream = await model.generateContentStream({
    contents: [{ role: "user", parts: [{ text: JSON.stringify({ messages }) }] }]
  });

  for await (const item of stream.stream) {
    const chunk = item.candidates?.[0]?.content.parts?.[0]?.text;
    if (chunk) onChunk(chunk);
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
    actionItems: recent.filter((message) => /\b(todo|please|need|ship|fix|review)\b/i.test(message.body)).slice(0, 5).map((message) => message.body),
    sentiment: "mixed"
  };
}
