import { ChatExperience } from "@/components/chat/chat-experience";
import { AuthPanel } from "@/components/auth/auth-panel";
import { getCurrentSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
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
  const session = await getCurrentSession();
  if (!session) {
    return <AuthPanel />;
  }

  const firstRoom = await prisma.room.findFirst({
    where: { members: { some: { userId: session.userId } } },
    select: { id: true }
  });

  const activeRoomId = firstRoom?.id ?? roomId;
  const messages = firstRoom
    ? await prisma.message.findMany({
        where: { roomId: activeRoomId, status: { not: "deleted" } },
        select: {
          id: true,
          roomId: true,
          authorId: true,
          body: true,
          threadId: true,
          parentId: true,
          clientNonce: true,
          createdAt: true,
          updatedAt: true
        },
        orderBy: { createdAt: "desc" },
        take: 50
      })
    : [];

  const initialMessages = messages.length
    ? messages
        .reverse()
        .map((message) => ({
          ...message,
          clientNonce: message.clientNonce ?? undefined,
          createdAt: message.createdAt.toISOString(),
          updatedAt: message.updatedAt.toISOString()
        }))
    : seedMessages;

  return <ChatExperience accessToken={session.accessToken} currentUserId={session.userId} initialMessages={initialMessages} roomId={activeRoomId} unreadCount={67} />;
}
