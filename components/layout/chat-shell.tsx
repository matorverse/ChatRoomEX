import { ChatExperience } from "@/components/chat/chat-experience";
import type { ChatMessage } from "@/lib/realtime/events";

const roomId = "6f9d30f0-3f55-49af-8297-4d4f0a990001";

const seedMessages: ChatMessage[] = [
  {
    id: "6f9d30f0-3f55-49af-8297-4d4f0a990101",
    roomId,
    authorId: "mira",
    body: "Morning check-in: keep launch notes short and kind today.",
    threadId: null,
    parentId: null,
    createdAt: new Date(Date.now() - 1000 * 60 * 14).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 14).toISOString()
  },
  {
    id: "6f9d30f0-3f55-49af-8297-4d4f0a990102",
    roomId,
    authorId: "kai",
    body: "I can take the reconnect QA pass on a throttled Android profile.",
    threadId: null,
    parentId: null,
    createdAt: new Date(Date.now() - 1000 * 60 * 9).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 9).toISOString()
  }
];

export async function ChatShell() {
  return <ChatExperience accessToken="development-token" initialMessages={seedMessages} roomId={roomId} unreadCount={67} />;
}
