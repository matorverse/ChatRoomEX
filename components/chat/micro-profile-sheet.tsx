"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Bell, MessageCircle, ShieldCheck, X } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";

type Props = {
  userId: string | null;
  onClose: () => void;
  members: { id: string; displayName: string; avatarUrl: string | null }[];
};

export function MicroProfileSheet({ userId, onClose, members }: Props) {
  const user = userId ? members.find(m => m.id === userId) : null;
  const displayName = user?.displayName ?? userId;
  
  return (
    <AnimatePresence>
      {userId ? (
        <motion.div className="fixed inset-0 z-50 bg-ink/20" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.section
            className="glass-overlay absolute inset-x-0 bottom-0 rounded-t-[1.75rem] p-5"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 430, damping: 38 }}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-label="Profile quick actions"
          >
            <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-muted/35" />
            <div className="mx-auto max-w-md">
              <div className="mb-5 flex items-center gap-3">
                <div className="grid size-14 place-items-center rounded-full bg-green-soft text-lg font-semibold">{displayName?.[0]?.toUpperCase()}</div>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-base font-semibold">{displayName}</h2>
                  <p className="truncate text-sm text-muted dark:text-muted-dark">Online in this room</p>
                </div>
                <IconButton label="Close profile" onClick={onClose}>
                  <X size={18} />
                </IconButton>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={async () => {
                    const res = await fetch("/api/rooms/dm", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ targetUserId: userId })
                    });
                    if (res.ok) {
                      const { roomId } = await res.json();
                      window.location.href = `/chat/${roomId}`;
                    }
                  }}
                  className="grid min-h-20 place-items-center rounded-2xl bg-surface p-2 text-sm dark:bg-surface-dark transition hover:bg-panel dark:hover:bg-panel-dark"
                >
                  <MessageCircle size={20} />
                  Message
                </button>
                <button className="grid min-h-20 place-items-center rounded-2xl bg-surface p-2 text-sm dark:bg-surface-dark opacity-50 cursor-not-allowed">
                  <Bell size={20} />
                  Mute
                </button>
                <button className="grid min-h-20 place-items-center rounded-2xl bg-surface p-2 text-sm dark:bg-surface-dark opacity-50 cursor-not-allowed">
                  <ShieldCheck size={20} />
                  Mod
                </button>
              </div>
            </div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
