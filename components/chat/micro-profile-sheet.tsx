"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Bell, MessageCircle, ShieldCheck, X, Swords } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";

type Props = {
  userId: string | null;
  onClose: () => void;
  members: {
    id: string;
    displayName: string;
    handle: string;
    avatarUrl: string | null;
    globalRole: string;
    roomRole: string;
  }[];
  isOnline: boolean;
  onChallenge: (userId: string) => void;
  onStartPm: (userId: string) => void;
};

export function MicroProfileSheet({ userId, onClose, members, isOnline, onChallenge, onStartPm }: Props) {
  const user = userId ? members.find(m => m.id === userId) : null;
  const rawDisplayName = user?.displayName ?? userId ?? "";
  const displayName = isOnline ? rawDisplayName : "Offline User";
  
  const roleBadge = user ? (user.globalRole !== "user" ? user.globalRole : user.roomRole) : "";

  return (
    <AnimatePresence>
      {userId && user ? (
        <motion.div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.section
            className="absolute inset-x-0 bottom-0 rounded-t-[1.75rem] border-t border-white/10 bg-neutral-900/90 p-6 text-white backdrop-blur-lg shadow-2xl"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 430, damping: 38 }}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-label="User Profile"
          >
            <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-white/20" />
            <div className="mx-auto max-w-md">
              <div className="mb-6 flex items-center gap-4">
                <div className={`grid size-16 place-items-center rounded-full text-xl font-bold border border-white/10 ${isOnline ? "bg-emerald-600/30 text-emerald-400" : "bg-neutral-800 text-neutral-500"}`}>
                  {displayName[0]?.toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-lg font-bold flex items-center gap-2">
                    {displayName}
                    {roleBadge && (
                      <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-300 border border-indigo-500/30">
                        {roleBadge}
                      </span>
                    )}
                  </h2>
                  <p className="truncate text-xs text-neutral-400">
                    {isOnline ? "🟢 Currently Online" : "🔴 Offline - Username Masked"}
                  </p>
                </div>
                <IconButton label="Close profile" onClick={onClose} className="hover:bg-white/10">
                  <X size={18} />
                </IconButton>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <button
                  disabled={!isOnline}
                  onClick={() => onStartPm(user.id)}
                  className={`flex flex-col items-center justify-center gap-2 rounded-2xl p-4 text-xs font-semibold border transition-all ${
                    isOnline
                      ? "bg-white/5 border-white/10 text-white hover:bg-white/10"
                      : "bg-neutral-800/40 border-transparent text-neutral-600 cursor-not-allowed"
                  }`}
                >
                  <MessageCircle size={22} className={isOnline ? "text-indigo-400" : "text-neutral-600"} />
                  Send PM
                </button>

                <button
                  disabled={!isOnline}
                  onClick={() => onChallenge(user.id)}
                  className={`flex flex-col items-center justify-center gap-2 rounded-2xl p-4 text-xs font-semibold border transition-all ${
                    isOnline
                      ? "bg-white/5 border-white/10 text-white hover:bg-white/10"
                      : "bg-neutral-800/40 border-transparent text-neutral-600 cursor-not-allowed"
                  }`}
                >
                  <Swords size={22} className={isOnline ? "text-rose-400" : "text-neutral-600"} />
                  Challenge
                </button>

                <button
                  disabled
                  className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-neutral-800/40 border border-transparent p-4 text-xs font-semibold text-neutral-600 cursor-not-allowed"
                  title="Use chat command (/mute username duration) for muting"
                >
                  <Bell size={22} />
                  Mute / Ban
                </button>
              </div>
              
              <div className="mt-4 rounded-xl bg-white/5 p-3 text-center text-[10px] text-neutral-400 border border-white/5">
                Staff Actions: Type <code className="text-amber-400">/mute username [minutes]</code> or <code className="text-rose-400">/ban username [days]</code> in the main chat input to apply moderator commands.
              </div>
            </div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
