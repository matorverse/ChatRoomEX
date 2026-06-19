import { z } from "zod";

export const roomIdSchema = z.string().uuid();
export const messageBodySchema = z.string().trim().min(1).max(4000);

export const chatMessageSchema = z.object({
  id: z.string().uuid(),
  roomId: roomIdSchema,
  authorId: z.string().uuid(),
  body: messageBodySchema,
  threadId: z.string().uuid().nullable(),
  parentId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  clientNonce: z.string().optional()
});

export const sendMessageSchema = z.object({
  roomId: roomIdSchema,
  body: messageBodySchema,
  clientNonce: z.string().min(8).max(80),
  threadId: z.string().uuid().optional(),
  parentId: z.string().uuid().optional()
});

export const typingSchema = z.object({
  roomId: roomIdSchema,
  threadId: z.string().uuid().optional(),
  isTyping: z.boolean()
});

export const reactionSchema = z.object({
  roomId: roomIdSchema,
  messageId: z.string().uuid(),
  emoji: z.string().min(1).max(32)
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type TypingInput = z.infer<typeof typingSchema>;
export type ReactionInput = z.infer<typeof reactionSchema>;

export type PresenceState = {
  userId: string;
  status: "online" | "idle" | "dnd" | "offline";
  lastSeenAt: string;
};

export type ServerToClientEvents = {
  "message:ack": (payload: { clientNonce: string; message: ChatMessage }) => void;
  "message:new": (payload: { message: ChatMessage }) => void;
  "message:batch": (payload: { messages: ChatMessage[]; cursor?: string }) => void;
  "message:rollback": (payload: { clientNonce: string; reason: string }) => void;
  "typing:update": (payload: TypingInput & { userId: string }) => void;
  "presence:update": (payload: { roomId: string; presence: PresenceState[] }) => void;
  "reaction:update": (payload: ReactionInput & { userId: string; op: "add" | "remove" }) => void;
  "read:receipt": (payload: { roomId: string; userId: string; messageId: string; readAt: string }) => void;
  "read:receipt:batch": (payload: { roomId: string; userId: string; messageIds: string[]; readAt: string }) => void;
  "sync:required": (payload: { roomId: string; since?: string }) => void;
};

export type ClientToServerEvents = {
  "room:join": (payload: { roomId: string }, ack: Ack<{ ok: true }>) => void;
  "message:send": (payload: SendMessageInput, ack: Ack<{ accepted: true }>) => void;
  "typing:set": (payload: TypingInput) => void;
  "reaction:toggle": (payload: ReactionInput) => void;
  "read:mark:batch": (payload: { roomId: string; messageIds: string[] }) => void;
  "sync:offline": (payload: { roomId: string; queued: SendMessageInput[] }, ack: Ack<{ accepted: number; failedNonce?: string; rollbackReason?: string }>) => void;
};

export type InterServerEvents = {
  ping: () => void;
};

export type SocketData = {
  userId: string;
  sessionId: string;
  roles: Map<string, string>;
};

export type Ack<T> = (response: T | { error: string }) => void;
