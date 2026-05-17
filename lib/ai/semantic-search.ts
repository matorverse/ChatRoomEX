import type { ChatMessage } from "@/lib/realtime/events";

export type SearchHit = {
  message: ChatMessage;
  score: number;
};

export async function semanticSearchMessages(query: string, messages: ChatMessage[]): Promise<SearchHit[]> {
  const terms = new Set(query.toLowerCase().split(/\s+/).filter(Boolean));
  return messages
    .map((message) => {
      const words = new Set(message.body.toLowerCase().split(/\s+/).filter(Boolean));
      const overlap = [...terms].filter((term) => words.has(term)).length;
      return { message, score: terms.size ? overlap / terms.size : 0 };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
}
