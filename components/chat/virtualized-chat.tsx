"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { motion } from "framer-motion";
import { CornerDownRight, SmilePlus } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/lib/realtime/events";

type Props = {
  messages: ChatMessage[];
  currentUserId: string;
  onReply: (message: ChatMessage) => void;
  onAuthorPress: (userId: string) => void;
};

export function VirtualizedChat({ messages, currentUserId, onReply, onAuthorPress }: Props) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 86,
    overscan: 8
  });

  useEffect(() => {
    rowVirtualizer.scrollToIndex(messages.length - 1, { align: "end" });
  }, [messages.length, rowVirtualizer]);

  return (
    <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto px-3 pb-28 pt-3 [overscroll-behavior:contain] [-webkit-overflow-scrolling:touch]">
      <div className="relative mx-auto w-full max-w-3xl" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const message = messages[virtualRow.index];
          const isMine = message.authorId === currentUserId;

          return (
            <article
              key={message.id}
              className="absolute left-0 top-0 w-full px-1 py-2"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
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
                    aria-label={`Open ${message.authorId} profile`}
                  >
                    {message.authorId.slice(0, 1).toUpperCase()}
                  </button>
                ) : null}
                <div className={`group max-w-[82%] ${isMine ? "items-end" : "items-start"}`}>
                  <div
                    className={`rounded-2xl border px-4 py-3 shadow-sm ${
                      isMine
                        ? "border-blue-soft bg-blue-soft/55"
                        : "border-border-soft bg-surface dark:border-border-soft-dark dark:bg-surface-dark"
                    }`}
                  >
                    <p className="text-sm leading-6">{message.body}</p>
                  </div>
                  <div className={`mt-1 flex items-center gap-1 ${isMine ? "justify-end" : "justify-start"}`}>
                    <time className="px-1 text-[11px] text-muted dark:text-muted-dark">
                      {new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(message.createdAt))}
                    </time>
                    <button className="grid size-8 place-items-center rounded-full text-muted opacity-80 hover:bg-panel" aria-label="React">
                      <SmilePlus size={15} />
                    </button>
                    <button className="grid size-8 place-items-center rounded-full text-muted opacity-80 hover:bg-panel" onClick={() => onReply(message)} aria-label="Reply in thread">
                      <CornerDownRight size={15} />
                    </button>
                  </div>
                </div>
              </motion.div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
