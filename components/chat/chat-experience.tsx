"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Hash, Menu, MessageCircle, Search, Shield, Sparkles, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { VirtualizedChat } from "@/components/chat/virtualized-chat";
import { MessageComposer } from "@/components/chat/message-composer";
import { ThreadPanel } from "@/components/chat/thread-panel";
import { MicroProfileSheet } from "@/components/chat/micro-profile-sheet";
import { IconButton } from "@/components/ui/icon-button";
import { useChatSocket } from "@/lib/realtime/use-chat-socket";
import type { ChatMessage } from "@/lib/realtime/events";

type Props = {
  roomId: string;
  accessToken: string;
  initialMessages: ChatMessage[];
  unreadCount: number;
};

type Pane = "rooms" | "chat" | "members";

export function ChatExperience({ roomId, accessToken, initialMessages, unreadCount }: Props) {
  const [pane, setPane] = useState<Pane>("chat");
  const [threadMessage, setThreadMessage] = useState<ChatMessage | null>(null);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const chat = useChatSocket(roomId, accessToken, initialMessages);
  const activeTitle = useMemo(() => (pane === "rooms" ? "Rooms" : pane === "members" ? "Members" : "Sanctuary"), [pane]);

  return (
    <div className="mx-auto grid min-h-dvh w-full max-w-[1440px] grid-cols-1 overflow-hidden lg:grid-cols-[288px_minmax(0,1fr)_320px]">
      <aside className="hidden border-r border-border-soft bg-surface/72 p-4 lg:block dark:border-border-soft-dark dark:bg-surface-dark/72">
        <RoomDrawer activeRoomId={roomId} />
      </aside>

      <section className="relative flex min-h-dvh flex-col overflow-hidden">
        <header className="glass-overlay sticky top-0 z-20 mx-3 mt-3 flex items-center gap-2 rounded-2xl px-3 py-2">
          <IconButton label="Rooms" active={pane === "rooms"} className="lg:hidden" onClick={() => setPane("rooms")}>
            <Menu size={19} />
          </IconButton>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{activeTitle}</p>
            <p className="truncate text-xs text-muted dark:text-muted-dark">
              {chat.connected ? "Live now" : "Reconnecting quietly"}
              {chat.typingUsers.length > 0 ? ` • ${chat.typingUsers.length} typing` : ""}
            </p>
          </div>
          {unreadCount > 50 ? (
            <button className="inline-flex h-11 items-center gap-2 rounded-full bg-yellow-soft/70 px-3 text-sm font-medium text-ink transition active:scale-95">
              <Sparkles size={16} />
              Catch up
            </button>
          ) : null}
          <IconButton label="Members" active={pane === "members"} className="lg:hidden" onClick={() => setPane("members")}>
            <Users size={19} />
          </IconButton>
        </header>

        <VirtualizedChat messages={chat.messages} onReply={setThreadMessage} onAuthorPress={setProfileUserId} />
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
                {pane === "rooms" ? <RoomDrawer activeRoomId={roomId} /> : <MemberDrawer onProfile={setProfileUserId} />}
              </motion.div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <ThreadPanel rootMessage={threadMessage} onClose={() => setThreadMessage(null)} />
        <MicroProfileSheet userId={profileUserId} onClose={() => setProfileUserId(null)} />
      </section>

      <aside className="hidden border-l border-border-soft bg-surface/72 p-4 lg:block dark:border-border-soft-dark dark:bg-surface-dark/72">
        <MemberDrawer onProfile={setProfileUserId} />
      </aside>
    </div>
  );
}

function RoomDrawer({ activeRoomId }: { activeRoomId: string }) {
  const rooms = ["Sanctuary", "Launch calm", "Announcements", "Light audio"];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-xl border border-border-soft bg-surface px-3 py-2 dark:border-border-soft-dark dark:bg-surface-dark">
        <Search size={16} className="text-muted" />
        <input className="w-full bg-transparent text-sm outline-none" placeholder="Search rooms" />
      </div>
      <div className="space-y-2">
        {rooms.map((room, index) => (
          <button
            key={room}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition hover:bg-panel dark:hover:bg-panel-dark"
            aria-current={index === 0 && activeRoomId ? "page" : undefined}
          >
            <span className="grid size-9 place-items-center rounded-full bg-blue-soft/45 text-blue-strong">
              <Hash size={17} />
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">{room}</span>
            {index === 0 ? <span className="rounded-full bg-green-soft px-2 py-0.5 text-xs">67</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function MemberDrawer({ onProfile }: { onProfile: (userId: string) => void }) {
  const users = ["Mira", "Kai", "Noor", "Avery", "June"];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Presence</h2>
        <Shield size={17} className="text-muted" />
      </div>
      <div className="space-y-2">
        {users.map((name, index) => (
          <button key={name} onClick={() => onProfile(name.toLowerCase())} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-panel dark:hover:bg-panel-dark">
            <span className="relative grid size-10 place-items-center rounded-full bg-green-soft font-semibold">{name[0]}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{name}</span>
              <span className="block truncate text-xs text-muted dark:text-muted-dark">{index < 3 ? "Online" : "Away"}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
