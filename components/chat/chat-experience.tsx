"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Hash, Menu, MessageCircle, Search, Shield, Users, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { VirtualizedChat } from "@/components/chat/virtualized-chat";
import { MessageComposer } from "@/components/chat/message-composer";
import { ThreadPanel } from "@/components/chat/thread-panel";
import { MicroProfileSheet } from "@/components/chat/micro-profile-sheet";
import { CatchUpButton } from "@/components/chat/catch-up-button";
import { IconButton } from "@/components/ui/icon-button";
import { useChatSocket } from "@/lib/realtime/use-chat-socket";
import type { ChatMessage, PresenceState } from "@/lib/realtime/events";
import { useSwipeNavigation } from "@/lib/ui/use-swipe-navigation";

type Props = {
  roomId: string;
  currentUserId: string;
  accessToken: string;
  initialMessages: ChatMessage[];
  unreadCount: number;
  unreadCounts: Record<string, number>;
  rooms: { id: string; name: string }[];
  initialMembers: { id: string; displayName: string; avatarUrl: string | null }[];
};

type Pane = "rooms" | "chat" | "members";

export function ChatExperience({ roomId, currentUserId, accessToken, initialMessages, unreadCount, unreadCounts = {}, rooms, initialMembers }: Props) {
  const [pane, setPane] = useState<Pane>("chat");
  const [threadMessage, setThreadMessage] = useState<ChatMessage | null>(null);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const chat = useChatSocket(roomId, currentUserId, accessToken, initialMessages);
  const filteredMessages = useMemo(() => {
    if (!searchQuery) return chat.messages;
    const lower = searchQuery.toLowerCase();
    return chat.messages.filter(m => m.body.toLowerCase().includes(lower));
  }, [chat.messages, searchQuery]);
  const activeTitle = useMemo(() => (pane === "rooms" ? "Rooms" : pane === "members" ? "Members" : "Sanctuary"), [pane]);
  const swipeHandlers = useSwipeNavigation((target) => {
    setPane((current) => {
      if (target === "left") return current === "members" ? "chat" : "rooms";
      return current === "rooms" ? "chat" : "members";
    });
  });

  return (
    <div className="mx-auto grid min-h-dvh w-full max-w-[1440px] grid-cols-1 overflow-hidden lg:grid-cols-[288px_minmax(0,1fr)_320px]">
      <aside className="hidden border-r border-border-soft bg-surface/72 p-4 lg:block dark:border-border-soft-dark dark:bg-surface-dark/72">
        <RoomDrawer activeRoomId={roomId} rooms={rooms} unreadCounts={unreadCounts} />
      </aside>

      <section className="relative flex min-h-dvh flex-col overflow-hidden" {...swipeHandlers}>
        <header className="glass-overlay sticky top-0 z-20 mx-3 mt-3 flex items-center gap-2 rounded-2xl px-3 py-2">
          <IconButton label="Rooms" active={pane === "rooms"} className="lg:hidden" onClick={() => setPane("rooms")}>
            <Menu size={19} />
          </IconButton>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{activeTitle}</p>
            <p className="truncate text-xs text-muted dark:text-muted-dark">
              {chat.connected ? "Live now" : "Reconnecting quietly"}
              {chat.typingUsers.length > 0 ? ` - ${chat.typingUsers.length} typing` : ""}
            </p>
          </div>
          <div className="hidden items-center gap-2 rounded-xl bg-surface/50 px-3 py-1.5 dark:bg-surface-dark/50 md:flex mr-2">
            <Search size={14} className="text-muted" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search chat..."
              className="w-24 bg-transparent text-xs outline-none transition-all focus:w-40"
            />
          </div>
          <CatchUpButton messages={chat.messages} unreadCount={unreadCount} />
          <IconButton label="Members" active={pane === "members"} className="lg:hidden" onClick={() => setPane("members")}>
            <Users size={19} />
          </IconButton>
        </header>

        <VirtualizedChat
          currentUserId={currentUserId}
          messages={filteredMessages}
          onReply={setThreadMessage}
          onAuthorPress={setProfileUserId}
          members={initialMembers}
          reactions={chat.reactions}
          readReceipts={chat.readReceipts}
          onToggleReaction={chat.toggleReaction}
          onMarkReadBatch={chat.markReadBatch}
        />
        <MessageComposer onSend={chat.sendMessage} onTyping={(isTyping) => chat.setTyping({ isTyping })} />

        <nav className="glass-overlay fixed inset-x-3 bottom-3 z-30 mx-auto flex max-w-sm justify-around rounded-2xl p-1 lg:hidden">
          <IconButton label="Rooms" active={pane === "rooms"} onClick={() => setPane("rooms")}>
            <Hash size={19} />
          </IconButton>
          <IconButton label="Chat" active={pane === "chat"} onClick={() => setPane("chat")}>
            <MessageCircle size={19} />
          </IconButton>
          <IconButton label="Members" active={pane === "members"} onClick={() => setPane("members")}>
            <Users size={19} />
          </IconButton>
        </nav>

        <AnimatePresence>
          {pane !== "chat" ? (
            <motion.div
              className="fixed inset-0 z-40 bg-ink/18 lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPane("chat")}
            >
              <motion.div
                className="glass-overlay h-full w-[86vw] max-w-[340px] p-4"
                initial={{ x: pane === "rooms" ? "-100%" : "100%" }}
                animate={{ x: pane === "rooms" ? 0 : "14vw" }}
                exit={{ x: pane === "rooms" ? "-100%" : "100%" }}
                transition={{ type: "spring", stiffness: 380, damping: 34 }}
                onClick={(event) => event.stopPropagation()}
              >
                {pane === "rooms" ? <RoomDrawer activeRoomId={roomId} rooms={rooms} unreadCounts={unreadCounts} /> : <MemberDrawer onProfile={setProfileUserId} members={initialMembers} presence={chat.presence} />}
              </motion.div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <ThreadPanel rootMessage={threadMessage} onClose={() => setThreadMessage(null)} />
        <MicroProfileSheet userId={profileUserId} onClose={() => setProfileUserId(null)} members={initialMembers} />
      </section>

      <aside className="hidden border-l border-border-soft bg-surface/72 p-4 lg:block dark:border-border-soft-dark dark:bg-surface-dark/72">
        <MemberDrawer onProfile={setProfileUserId} members={initialMembers} presence={chat.presence} />
      </aside>
    </div>
  );
}

function RoomDrawer({ activeRoomId, rooms, unreadCounts }: { activeRoomId: string; rooms: { id: string; name: string }[]; unreadCounts: Record<string, number> }) {
  const router = useRouter();
  
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-xl border border-border-soft bg-surface px-3 py-2 dark:border-border-soft-dark dark:bg-surface-dark">
        <Search size={16} className="text-muted" />
        <input className="w-full bg-transparent text-sm outline-none" placeholder="Search rooms" />
      </div>
      <div className="space-y-2">
        <Link
          href={"/chat/new" as any}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition hover:bg-panel dark:hover:bg-panel-dark text-blue-strong font-medium"
        >
          <span className="grid size-9 place-items-center rounded-full bg-blue-soft/45">
            <Plus size={17} />
          </span>
          New Room
        </Link>
        {rooms.map((room) => {
          const count = unreadCounts[room.id] ?? 0;
          return (
            <Link
              key={room.id}
              href={`/chat/${room.id}` as any}
              prefetch={true}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition hover:bg-panel dark:hover:bg-panel-dark"
              aria-current={room.id === activeRoomId ? "page" : undefined}
            >
              <span className="grid size-9 place-items-center rounded-full bg-blue-soft/45 text-blue-strong">
                <Hash size={17} />
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{room.name}</span>
              {count > 0 ? (
                <span className="rounded-full bg-green-soft px-2 py-0.5 text-xs font-semibold text-green-strong">
                  {count}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function MemberDrawer({
  onProfile,
  members,
  presence
}: {
  onProfile: (userId: string) => void;
  members: { id: string; displayName: string; avatarUrl: string | null }[];
  presence: PresenceState[];
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Presence</h2>
        <Shield size={17} className="text-muted" />
      </div>
      <div className="space-y-2">
        {members.map((member) => {
          const userPresence = presence.find((p) => p.userId === member.id);
          const isOnline = userPresence?.status === "online";
          return (
            <button key={member.id} onClick={() => onProfile(member.id)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-panel dark:hover:bg-panel-dark">
              <span className={`relative grid size-10 place-items-center rounded-full font-semibold ${isOnline ? "bg-green-soft" : "bg-surface"}`}>{member.displayName[0]}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{member.displayName}</span>
                <span className="block truncate text-xs text-muted dark:text-muted-dark">{isOnline ? "Online" : "Away"}</span>
              </span>
            </button>
          );
        })}
      </div>
      
      <div className="pt-6">
        <button
          onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST" });
            window.location.href = "/";
          }}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-surface px-4 py-2.5 text-sm font-semibold text-danger transition hover:bg-panel dark:bg-surface-dark dark:hover:bg-panel-dark border border-border-soft dark:border-border-soft-dark shadow-sm"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
