"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { motion } from "framer-motion";
import { CornerDownRight, SmilePlus } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/realtime/events";

type Props = {
  messages: ChatMessage[];
  currentUserId: string;
  onReply: (message: ChatMessage) => void;
  onAuthorPress: (userId: string) => void;
  members: { id: string; displayName: string; avatarUrl: string | null }[];
  reactions: Record<string, Record<string, string[]>>;
  readReceipts: Record<string, string[]>;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onMarkReadBatch: (messageIds: string[]) => void;
};

export function VirtualizedChat({ messages, currentUserId, onReply, onAuthorPress, members, reactions, readReceipts, onToggleReaction, onMarkReadBatch }: Props) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 106,
    overscan: 8
  });

  const pendingReadMarks = useRef<Set<string>>(new Set());
  const flushTimeout = useRef<number | null>(null);

  const handleMarkRead = useCallback((id: string) => {
    pendingReadMarks.current.add(id);
    if (!flushTimeout.current) {
      flushTimeout.current = window.setTimeout(() => {
        onMarkReadBatch(Array.from(pendingReadMarks.current));
        pendingReadMarks.current.clear();
        flushTimeout.current = null;
      }, 500);
    }
  }, [onMarkReadBatch]);

  const membersMap = useMemo(() => {
    return new Map(members.map((m) => [m.id, m]));
  }, [members]);

  useEffect(() => {
    rowVirtualizer.scrollToIndex(messages.length - 1, { align: "end" });
  }, [messages.length, rowVirtualizer]);

  return (
    <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto px-3 pb-28 pt-3 [overscroll-behavior:contain] [-webkit-overflow-scrolling:touch]">
      <div className="relative mx-auto w-full max-w-3xl" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const message = messages[virtualRow.index];
          const author = membersMap.get(message.authorId);
          return (
            <MessageRow
              key={message.id}
              message={message}
              virtualRow={virtualRow}
              currentUserId={currentUserId}
              author={author}
              reactions={reactions[message.id] ?? EMPTY_REACTIONS}
              readReceipts={readReceipts[message.id] ?? EMPTY_RECEIPTS}
              onReply={onReply}
              onAuthorPress={onAuthorPress}
              onToggleReaction={onToggleReaction}
              onMarkRead={handleMarkRead}
            />
          );
        })}
      </div>
    </div>
  );
}

const EMPTY_REACTIONS: Record<string, string[]> = {};
const EMPTY_RECEIPTS: string[] = [];

function checkReactionsEqual(prev: Record<string, string[]>, next: Record<string, string[]>) {
  if (prev === next) return true;
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);
  if (prevKeys.length !== nextKeys.length) return false;
  for (const emoji of prevKeys) {
    const prevUsers = prev[emoji] || EMPTY_RECEIPTS;
    const nextUsers = next[emoji] || EMPTY_RECEIPTS;
    if (prevUsers !== nextUsers) {
      if (prevUsers.length !== nextUsers.length) return false;
      for (let i = 0; i < prevUsers.length; i++) {
        if (prevUsers[i] !== nextUsers[i]) return false;
      }
    }
  }
  return true;
}

function checkReceiptsEqual(prev: string[], next: string[]) {
  if (prev === next) return true;
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i++) {
    if (prev[i] !== next[i]) return false;
  }
  return true;
}

const MessageRow = memo(function MessageRow({ message, virtualRow, currentUserId, author, reactions, readReceipts, onReply, onAuthorPress, onToggleReaction, onMarkRead }: any) {
  const isMine = message.authorId === currentUserId;
  const displayName = author?.displayName ?? message.authorId;
  const isReadByMe = readReceipts.includes(currentUserId);
  const hasBeenRead = readReceipts.some((id: string) => id !== currentUserId);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isMine && !isReadByMe) {
      onMarkRead(message.id);
    }
  }, [message.id, isMine, isReadByMe, onMarkRead]);

  return (
    <article className="absolute left-0 top-0 w-full px-1 py-2" style={{ transform: `translateY(${virtualRow.start}px)` }}>
      <motion.div
        className={`flex gap-2 ${isMine ? "justify-end" : "justify-start"}`}
        drag="x"
        dragConstraints={{ left: -72, right: 72 }}
        dragElastic={0.08}
        onDragEnd={(_, info) => {
          if (Math.abs(info.offset.x) > 48) onReply(message);
        }}
      >
        {!isMine ? (
          <button
            className="mt-1 grid size-9 shrink-0 place-items-center rounded-full bg-blue-soft/55 text-sm font-semibold"
            onClick={() => onAuthorPress(message.authorId)}
          >
            {displayName.slice(0, 1).toUpperCase()}
          </button>
        ) : null}
        <div className={`group max-w-[82%] flex flex-col ${isMine ? "items-end" : "items-start"}`}>
          {!isMine ? <span className="mb-1 ml-1 block text-xs font-medium text-muted-strong dark:text-muted">{displayName}</span> : null}
          <div
            className={`rounded-2xl border px-4 py-3 shadow-sm relative transition-opacity duration-200 ${
              message.localState === "pending" ? "opacity-70" : ""
            } ${
              message.localState === "failed" ? "border-danger/40 bg-danger-soft/10 dark:border-danger/30 text-danger-strong" : ""
            } ${
              isMine && message.localState !== "failed" ? "border-blue-soft bg-blue-soft/55 rounded-br-sm" : ""
            } ${
              !isMine && message.localState !== "failed" ? "border-border-soft bg-surface dark:border-border-soft-dark dark:bg-surface-dark rounded-bl-sm" : ""
            }`}
          >
            <p className="text-sm leading-6 break-words whitespace-pre-wrap">
              {message.body.split(/!\[Image\]\((.*?)\)/).map((part: string, i: number) => {
                if (i % 2 === 1) {
                  // eslint-disable-next-line @next/next/no-img-element
                  return <img key={i} src={part} alt="Attachment" loading="lazy" className="mt-2 max-h-60 w-auto rounded-xl object-contain border border-border-soft dark:border-border-soft-dark shadow-sm" />;
                }
                return part;
              })}
            </p>
            
            {Object.keys(reactions).length > 0 ? (
              <div className="absolute -bottom-3 right-2 flex gap-1 bg-surface dark:bg-surface-dark border border-border-soft dark:border-border-soft-dark rounded-full px-1.5 py-0.5 shadow-sm text-xs">
                {Object.entries(reactions).map(([emoji, users]: any) => (
                  <span key={emoji} className="flex items-center gap-1" onClick={(e) => { e.stopPropagation(); onToggleReaction(message.id, emoji); }}>
                    <span>{emoji}</span>
                    <span className="text-[10px] opacity-70">{users.length}</span>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <div className={`mt-1 flex items-center gap-1 ${isMine ? "justify-end" : "justify-start"}`}>
            <time className="px-1 text-[11px] font-medium text-muted/80 dark:text-muted-dark" suppressHydrationWarning>
              {mounted
                ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(message.createdAt))
                : ""}
            </time>
            {isMine ? (
              message.localState === "pending" ? (
                <span className="text-[10px] text-muted-strong dark:text-muted mr-1 animate-pulse">
                  Sending...
                </span>
              ) : message.localState === "failed" ? (
                <span className="text-[10px] font-bold text-danger mr-1" title="Failed to send">
                  ✕ Failed
                </span>
              ) : (
                <span className="text-[10px] font-bold text-blue-strong mr-1">
                  {hasBeenRead ? "✓✓" : "✓"}
                </span>
              )
            ) : null}
            <button className="grid size-8 place-items-center rounded-full text-muted opacity-80 hover:bg-panel" onClick={() => onToggleReaction(message.id, "❤️")}>
              <SmilePlus size={15} />
            </button>
            <button className="grid size-8 place-items-center rounded-full text-muted opacity-80 hover:bg-panel" onClick={() => onReply(message)}>
              <CornerDownRight size={15} />
            </button>
          </div>
        </div>
      </motion.div>
    </article>
  );
}, (prev, next) => {
  return (
    prev.message.id === next.message.id &&
    prev.message.updatedAt === next.message.updatedAt &&
    prev.message.localState === next.message.localState &&
    prev.virtualRow.start === next.virtualRow.start &&
    prev.virtualRow.size === next.virtualRow.size &&
    prev.currentUserId === next.currentUserId &&
    prev.author === next.author &&
    checkReactionsEqual(prev.reactions, next.reactions) &&
    checkReceiptsEqual(prev.readReceipts, next.readReceipts)
  );
});
