"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import type { ChatMessage } from "@/lib/realtime/events";
import { IconButton } from "@/components/ui/icon-button";

export function ThreadPanel({ rootMessage, onClose }: { rootMessage: ChatMessage | null; onClose: () => void }) {
  return (
    <AnimatePresence>
      {rootMessage ? (
        <motion.aside
          className="glass-overlay fixed inset-x-3 bottom-24 z-40 rounded-2xl p-4 lg:bottom-6 lg:left-auto lg:right-6 lg:top-20 lg:w-[360px]"
          initial={{ opacity: 0, y: 24, x: 0 }}
          animate={{ opacity: 1, y: 0, x: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ type: "spring", stiffness: 420, damping: 36 }}
          role="dialog"
          aria-modal="false"
          aria-label="Thread"
        >
          <div className="mb-3 flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-semibold">Thread</h2>
              <p className="truncate text-xs text-muted dark:text-muted-dark">Context stays beside the main room</p>
            </div>
            <IconButton label="Close thread" onClick={onClose}>
              <X size={18} />
            </IconButton>
          </div>
          <div className="rounded-xl border border-border-soft bg-surface p-3 text-sm leading-6 dark:border-border-soft-dark dark:bg-surface-dark">
            {rootMessage.body}
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
