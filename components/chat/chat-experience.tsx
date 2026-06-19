"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Hash, Menu, MessageCircle, Search, Shield, Users, Plus, Settings, Swords, Trophy, X, Send, Loader2, Sparkles, MessageSquare } from "lucide-react";
import { useMemo, useState, useEffect, useRef } from "react";
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

type Member = {
  id: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  globalRole: string;
  roomRole: string;
  blockChallenges: boolean;
  blockPMs: boolean;
};

type Props = {
  roomId: string;
  currentUserId: string;
  accessToken: string;
  initialMessages: ChatMessage[];
  unreadCount: number;
  unreadCounts: Record<string, number>;
  rooms: { id: string; name: string }[];
  initialMembers: Member[];
};

type Pane = "rooms" | "chat" | "members";

const DEFAULT_AVATARS = [
  "https://api.dicebear.com/7.x/bottts/svg?seed=Shadow",
  "https://api.dicebear.com/7.x/bottts/svg?seed=Ghost",
  "https://api.dicebear.com/7.x/bottts/svg?seed=Wizard",
  "https://api.dicebear.com/7.x/bottts/svg?seed=Dragon",
  "https://api.dicebear.com/7.x/bottts/svg?seed=Phoenix",
  "https://api.dicebear.com/7.x/bottts/svg?seed=Valkyrie",
  "https://api.dicebear.com/7.x/bottts/svg?seed=Titan",
  "https://api.dicebear.com/7.x/bottts/svg?seed=Rogue"
];

export function ChatExperience({
  roomId,
  currentUserId,
  accessToken,
  initialMessages,
  unreadCount,
  unreadCounts = {},
  rooms,
  initialMembers
}: Props) {
  const [pane, setPane] = useState<Pane>("chat");
  const [threadMessage, setThreadMessage] = useState<ChatMessage | null>(null);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  
  // Custom Tabs / Modal view state
  const [activeTab, setActiveTab] = useState<"chat" | "leaderboard">("chat");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isPmOpen, setIsPmOpen] = useState(false);
  const [selectedPmUser, setSelectedPmUser] = useState<string | null>(null);
  const [pmInput, setPmInput] = useState("");
  const [pmHistory, setPmHistory] = useState<any[]>([]);

  // Admin PM Inspection state
  const [adminUser1, setAdminUser1] = useState("");
  const [adminUser2, setAdminUser2] = useState("");
  const [inspectedHistory, setInspectedHistory] = useState<any[]>([]);
  const [isInspecting, setIsInspecting] = useState(false);

  const chat = useChatSocket(roomId, currentUserId, accessToken, initialMessages);
  const currentUser = useMemo(() => initialMembers.find(m => m.id === currentUserId), [initialMembers, currentUserId]);

  // Settings State Form
  const [blockChallenges, setBlockChallenges] = useState(currentUser?.blockChallenges ?? false);
  const [blockPMs, setBlockPMs] = useState(currentUser?.blockPMs ?? false);
  const [selectedAvatar, setSelectedAvatar] = useState(currentUser?.avatarUrl ?? DEFAULT_AVATARS[0]);
  const [customAvatarUrl, setCustomAvatarUrl] = useState("");
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  // Sync settings local form values if initialMembers changes
  useEffect(() => {
    if (currentUser) {
      setBlockChallenges(currentUser.blockChallenges);
      setBlockPMs(currentUser.blockPMs);
      setSelectedAvatar(currentUser.avatarUrl ?? DEFAULT_AVATARS[0]);
    }
  }, [currentUser]);

  // Handle active PM sync and auto-update
  const activePmHistory = useMemo(() => {
    if (!selectedPmUser) return [];
    const loadedIds = new Set(pmHistory.map(m => m.id));
    const socketPms = chat.pms.filter(m => 
      (m.senderId === currentUserId && m.receiverId === selectedPmUser) ||
      (m.senderId === selectedPmUser && m.receiverId === currentUserId)
    );
    const combined = [...pmHistory, ...socketPms.filter(m => !loadedIds.has(m.id))];
    return combined.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [pmHistory, chat.pms, selectedPmUser, currentUserId]);

  const loadPmHistory = async (userId: string) => {
    const history = await chat.getPMHistory(userId);
    setPmHistory(history);
  };

  const handleSendPm = () => {
    if (!selectedPmUser || !pmInput.trim()) return;
    chat.sendPM(selectedPmUser, pmInput.trim());
    setPmInput("");
  };

  const handleSaveSettings = async () => {
    setIsSavingSettings(true);
    const ok = await chat.updateSettings(blockChallenges, blockPMs, customAvatarUrl || undefined, selectedAvatar);
    setIsSavingSettings(false);
    if (ok) {
      setIsSettingsOpen(false);
    }
  };

  const handleInspect = async () => {
    if (!adminUser1 || !adminUser2) return;
    setIsInspecting(true);
    const history = await chat.inspectPMHistory(adminUser1, adminUser2);
    setInspectedHistory(history);
    setIsInspecting(false);
  };

  const activeRoom = useMemo(() => rooms.find(r => r.id === roomId), [rooms, roomId]);
  const isTournamentRoom = useMemo(() => {
    if (!activeRoom) return false;
    const nameLower = activeRoom.name.toLowerCase();
    return nameLower === "tournaments" || nameLower === "tournament";
  }, [activeRoom]);

  const filteredMessages = useMemo(() => {
    if (!searchQuery) return chat.messages;
    const lower = searchQuery.toLowerCase();
    return chat.messages.filter(m => m.body.toLowerCase().includes(lower));
  }, [chat.messages, searchQuery]);

  const activeTitle = useMemo(() => (pane === "rooms" ? "Rooms" : pane === "members" ? "Members" : activeRoom?.name ?? "Sanctuary"), [pane, activeRoom]);
  
  const swipeHandlers = useSwipeNavigation((target) => {
    setPane((current) => {
      if (target === "left") return current === "members" ? "chat" : "rooms";
      return current === "rooms" ? "chat" : "members";
    });
  });

  // Parse battle challenge HP levels
  const battleHp = useMemo(() => {
    if (!chat.activeChallenge || !chat.activeChallenge.log) return { challengerHp: 100, defenderHp: 100 };
    const log = chat.activeChallenge.log;
    for (let i = log.length - 1; i >= 0; i--) {
      const match = log[i].match(/HP:\s*Challenger:\s*(\d+)\s*\|\s*Defender:\s*(\d+)/i);
      if (match) {
        return {
          challengerHp: parseInt(match[1], 10),
          defenderHp: parseInt(match[2], 10)
        };
      }
    }
    return { challengerHp: 100, defenderHp: 100 };
  }, [chat.activeChallenge]);

  // Scroll target reference for PM messages
  const pmEndRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    pmEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activePmHistory]);

  const pmUserObj = useMemo(() => initialMembers.find(m => m.id === selectedPmUser), [initialMembers, selectedPmUser]);

  return (
    <div className="mx-auto grid min-h-dvh w-full max-w-[1440px] grid-cols-1 overflow-hidden lg:grid-cols-[288px_minmax(0,1fr)_320px] bg-gradient-to-br from-neutral-950 via-slate-950 to-zinc-950 text-white font-sans antialiased">
      
      {/* Rooms Drawer (Sidebar Left) */}
      <aside className="hidden border-r border-white/10 bg-black/40 backdrop-blur-lg p-4 lg:flex lg:flex-col lg:justify-between text-neutral-100">
        <div className="space-y-6">
          <div className="flex items-center justify-between px-2">
            <h1 className="text-lg font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent flex items-center gap-2">
              <Sparkles size={18} className="text-blue-400" />
              ChatRoomEX
            </h1>
            <div className="flex gap-1">
              <IconButton label="PM Panel" className="hover:bg-white/10 border border-white/5" onClick={() => setIsPmOpen(true)}>
                <MessageCircle size={16} />
              </IconButton>
              <IconButton label="Settings" className="hover:bg-white/10 border border-white/5" onClick={() => setIsSettingsOpen(true)}>
                <Settings size={16} />
              </IconButton>
            </div>
          </div>
          <RoomDrawer activeRoomId={roomId} rooms={rooms} unreadCounts={unreadCounts} />
        </div>
        <div className="border-t border-white/5 pt-4">
          <SignOutButton />
        </div>
      </aside>

      {/* Chat Area Container */}
      <section className="relative flex min-h-dvh flex-col overflow-hidden border-r border-white/5 bg-transparent" {...swipeHandlers}>
        <header className="sticky top-0 z-20 mx-3 mt-3 flex items-center gap-2 rounded-2xl border border-white/10 bg-black/45 backdrop-blur-md px-3 py-2 shadow-lg">
          <IconButton label="Rooms" active={pane === "rooms"} className="lg:hidden hover:bg-white/5" onClick={() => setPane("rooms")}>
            <Menu size={19} />
          </IconButton>
          
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold flex items-center gap-2">
              <Hash size={16} className="text-indigo-400" />
              {activeTitle}
            </p>
            <p className="truncate text-[10px] text-neutral-400">
              {chat.connected ? "🟢 Live connection" : "🔴 Reconnecting..."}
              {chat.typingUsers.length > 0 ? ` • ${chat.typingUsers.length} users typing` : ""}
            </p>
          </div>

          {/* Tab Switcher for Tournaments Room */}
          {isTournamentRoom && pane === "chat" && (
            <div className="flex bg-neutral-900/60 p-0.5 rounded-lg border border-white/5 mr-2">
              <button
                onClick={() => setActiveTab("chat")}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${activeTab === "chat" ? "bg-white/10 text-white" : "text-neutral-400 hover:text-white"}`}
              >
                Chat
              </button>
              <button
                onClick={() => setActiveTab("leaderboard")}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1 ${activeTab === "leaderboard" ? "bg-white/10 text-white" : "text-neutral-400 hover:text-white"}`}
              >
                <Trophy size={12} className="text-amber-400" />
                Standings
              </button>
            </div>
          )}

          <div className="hidden items-center gap-2 rounded-xl border border-white/5 bg-white/5 px-3 py-1.5 md:flex mr-2">
            <Search size={14} className="text-neutral-400" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search room..."
              className="w-24 bg-transparent text-xs outline-none transition-all focus:w-40 text-white placeholder-neutral-500"
            />
          </div>

          <div className="flex md:hidden gap-1 mr-1">
            <IconButton label="PM Panel" className="hover:bg-white/10" onClick={() => setIsPmOpen(true)}>
              <MessageCircle size={16} />
            </IconButton>
            <IconButton label="Settings" className="hover:bg-white/10" onClick={() => setIsSettingsOpen(true)}>
              <Settings size={16} />
            </IconButton>
          </div>

          <CatchUpButton messages={chat.messages} unreadCount={unreadCount} />
          <IconButton label="Members" active={pane === "members"} className="lg:hidden hover:bg-white/5" onClick={() => setPane("members")}>
            <Users size={19} />
          </IconButton>
        </header>

        {activeTab === "leaderboard" && isTournamentRoom && pane === "chat" ? (
          <div className="flex-1 overflow-y-auto p-6 max-w-3xl mx-auto w-full">
            <div className="rounded-2xl border border-white/10 bg-black/40 backdrop-blur-md p-6 shadow-2xl">
              <h2 className="text-lg font-bold flex items-center gap-2 mb-6 border-b border-white/10 pb-3 text-amber-300">
                <Trophy className="text-amber-400" />
                Tournament Leaderboard Standing
              </h2>
              {chat.leaderboard.length === 0 ? (
                <p className="text-sm text-neutral-400 text-center py-8">No score logs found. Host a tournament to score!</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-white/10 text-neutral-400 text-xs font-semibold uppercase tracking-wider">
                        <th className="py-3 px-4">Rank</th>
                        <th className="py-3 px-4">Player</th>
                        <th className="py-3 px-4 text-right">Tournament Points</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {chat.leaderboard.map((item, idx) => (
                        <tr key={item.userId} className="hover:bg-white/5 transition-colors">
                          <td className="py-3 px-4 font-bold text-neutral-300">
                            {idx === 0 ? "🥇 1st" : idx === 1 ? "🥈 2nd" : idx === 2 ? "🥉 3rd" : `#${idx + 1}`}
                          </td>
                          <td className="py-3 px-4 font-medium">{item.displayName}</td>
                          <td className="py-3 px-4 text-right font-semibold text-indigo-400">{item.points} pts</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : (
          <VirtualizedChat
            currentUserId={currentUserId}
            messages={filteredMessages}
            onReply={setThreadMessage}
            onAuthorPress={setProfileUserId}
            members={initialMembers}
            presence={chat.presence}
            reactions={chat.reactions}
            readReceipts={chat.readReceipts}
            onToggleReaction={chat.toggleReaction}
            onMarkReadBatch={chat.markReadBatch}
          />
        )}
        
        {activeTab === "chat" && (
          <MessageComposer onSend={chat.sendMessage} onTyping={(isTyping) => chat.setTyping({ isTyping })} />
        )}

        <nav className="border border-white/10 bg-black/55 backdrop-blur-md fixed inset-x-3 bottom-3 z-30 mx-auto flex max-w-sm justify-around rounded-2xl p-1 lg:hidden shadow-xl">
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

        {/* Small screen sliders */}
        <AnimatePresence>
          {pane !== "chat" ? (
            <motion.div
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPane("chat")}
            >
              <motion.div
                className="h-full w-[86vw] max-w-[340px] p-4 bg-neutral-900 border-r border-white/10 flex flex-col justify-between"
                initial={{ x: pane === "rooms" ? "-100%" : "100%" }}
                animate={{ x: pane === "rooms" ? 0 : "14vw" }}
                exit={{ x: pane === "rooms" ? "-100%" : "100%" }}
                transition={{ type: "spring", stiffness: 380, damping: 34 }}
                onClick={(event) => event.stopPropagation()}
              >
                {pane === "rooms" ? (
                  <div className="space-y-4">
                    <h2 className="text-base font-bold flex items-center gap-2 border-b border-white/5 pb-2 text-indigo-400">
                      <Hash size={18} /> Rooms
                    </h2>
                    <RoomDrawer activeRoomId={roomId} rooms={rooms} unreadCounts={unreadCounts} />
                  </div>
                ) : (
                  <MemberDrawer onProfile={setProfileUserId} members={initialMembers} presence={chat.presence} />
                )}
                
                <div className="border-t border-white/5 pt-4">
                  <SignOutButton />
                </div>
              </motion.div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <ThreadPanel rootMessage={threadMessage} onClose={() => setThreadMessage(null)} />
        
        {/* Micro Profile Overlay */}
        <MicroProfileSheet
          userId={profileUserId}
          onClose={() => setProfileUserId(null)}
          members={initialMembers}
          isOnline={profileUserId ? chat.presence.some(p => p.userId === profileUserId && p.status === "online") : false}
          onChallenge={async (uid) => {
            const cid = await chat.sendChallenge(uid);
            if (cid) {
              setProfileUserId(null);
            }
          }}
          onStartPm={(uid) => {
            setSelectedPmUser(uid);
            void loadPmHistory(uid);
            setIsPmOpen(true);
            setProfileUserId(null);
          }}
        />
      </section>

      {/* Sidebar Right (Members list) */}
      <aside className="hidden border-l border-white/10 bg-black/40 backdrop-blur-lg p-4 lg:block overflow-y-auto">
        <MemberDrawer onProfile={setProfileUserId} members={initialMembers} presence={chat.presence} />
      </aside>

      {/* Battle Challenge Overlays */}
      <AnimatePresence>
        {chat.activeChallenge && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-xl rounded-3xl border border-white/15 bg-neutral-900/90 text-white p-6 shadow-2xl backdrop-blur-xl flex flex-col max-h-[85vh]"
            >
              {chat.activeChallenge.status === "pending" && chat.activeChallenge.challengerId !== currentUserId ? (
                // Defender Challenge Request Screen
                <div className="text-center py-6 space-y-6">
                  <div className="mx-auto grid size-16 place-items-center rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30 animate-pulse">
                    <Swords size={32} />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold">Battle Challenge Received!</h3>
                    <p className="text-sm text-neutral-400 mt-2">
                      <span className="font-semibold text-rose-400">{chat.activeChallenge.challengerName ?? "An opponent"}</span> wants to duel with you!
                    </p>
                  </div>
                  <div className="flex gap-3 justify-center">
                    <button
                      onClick={() => chat.respondChallenge(chat.activeChallenge.challengeId, "decline")}
                      className="px-6 py-2.5 rounded-xl border border-white/10 hover:bg-white/5 font-semibold text-xs transition"
                    >
                      Decline
                    </button>
                    <button
                      onClick={() => chat.respondChallenge(chat.activeChallenge.challengeId, "accept")}
                      className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700 font-semibold text-xs text-white shadow-lg transition"
                    >
                      Accept Battle
                    </button>
                  </div>
                </div>
              ) : chat.activeChallenge.status === "pending" ? (
                // Challenger Waiting Screen
                <div className="text-center py-8 space-y-5">
                  <Loader2 size={36} className="animate-spin text-indigo-400 mx-auto" />
                  <div>
                    <h3 className="text-lg font-bold">Challenge Sent</h3>
                    <p className="text-xs text-neutral-400 mt-1">Waiting for opponent to accept or decline the duel...</p>
                  </div>
                  <button
                    onClick={() => chat.respondChallenge(chat.activeChallenge.challengeId, "decline")}
                    className="px-4 py-2 rounded-lg border border-white/10 text-neutral-400 hover:text-white text-xs transition"
                  >
                    Cancel Challenge
                  </button>
                </div>
              ) : (
                // ACTIVE BATTLE ARENA SCREEN
                <div className="flex flex-col flex-1 min-h-0 space-y-4">
                  <div className="flex items-center justify-between border-b border-white/10 pb-3">
                    <h3 className="text-md font-bold flex items-center gap-2 text-rose-400">
                      <Swords size={18} /> Battle Arena
                    </h3>
                    <span className="text-xs bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20 text-rose-300 font-mono capitalize">
                      {chat.activeChallenge.status}
                    </span>
                  </div>

                  {/* HP HUD bar */}
                  <div className="grid grid-cols-2 gap-4 border border-white/5 bg-black/30 p-4 rounded-xl">
                    {/* Challenger */}
                    <div className="space-y-1">
                      <span className="text-xs font-bold block truncate">Challenger HP</span>
                      <div className="h-2.5 bg-neutral-800 rounded-full overflow-hidden border border-white/5">
                        <div
                          className="h-full bg-gradient-to-r from-red-600 to-rose-500 transition-all duration-300"
                          style={{ width: `${battleHp.challengerHp}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-neutral-400 block font-mono text-right">{battleHp.challengerHp} / 100</span>
                    </div>

                    {/* Defender */}
                    <div className="space-y-1">
                      <span className="text-xs font-bold block truncate">Defender HP</span>
                      <div className="h-2.5 bg-neutral-800 rounded-full overflow-hidden border border-white/5">
                        <div
                          className="h-full bg-gradient-to-r from-red-600 to-rose-500 transition-all duration-300"
                          style={{ width: `${battleHp.defenderHp}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-neutral-400 block font-mono text-right">{battleHp.defenderHp} / 100</span>
                    </div>
                  </div>

                  {/* Scrollable battle log */}
                  <div className="flex-1 overflow-y-auto bg-black/40 rounded-xl p-3 border border-white/5 font-mono text-[11px] space-y-1.5 max-h-[30vh]">
                    {chat.activeChallenge.log?.map((logLine: string, idx: number) => (
                      <div key={idx} className="leading-relaxed border-b border-white/5 pb-1 last:border-0 text-neutral-300">
                        {logLine}
                      </div>
                    ))}
                  </div>

                  {/* Actions control bar */}
                  {chat.activeChallenge.status !== "completed" ? (
                    <div className="space-y-2">
                      <p className="text-[10px] text-center text-neutral-400">Choose your move:</p>
                      <div className="grid grid-cols-3 gap-2">
                        <button
                          onClick={() => chat.makeChallengeTurn(chat.activeChallenge.challengeId, "attack")}
                          className="py-3 rounded-xl bg-gradient-to-b from-rose-600 to-rose-700 hover:from-rose-700 hover:to-rose-800 font-bold text-xs border border-rose-500/20 shadow-md text-white transition flex flex-col items-center gap-1"
                        >
                          <span>⚔️</span>
                          <span>Attack</span>
                        </button>
                        <button
                          onClick={() => chat.makeChallengeTurn(chat.activeChallenge.challengeId, "defend")}
                          className="py-3 rounded-xl bg-gradient-to-b from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 font-bold text-xs border border-blue-500/20 shadow-md text-white transition flex flex-col items-center gap-1"
                        >
                          <span>🛡️</span>
                          <span>Defend</span>
                        </button>
                        <button
                          onClick={() => chat.makeChallengeTurn(chat.activeChallenge.challengeId, "dodge")}
                          className="py-3 rounded-xl bg-gradient-to-b from-amber-600 to-amber-700 hover:from-amber-700 hover:to-amber-800 font-bold text-xs border border-amber-500/20 shadow-md text-white transition flex flex-col items-center gap-1"
                        >
                          <span>💨</span>
                          <span>Dodge</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="pt-2 text-center">
                      <button
                        onClick={() => {
                          // Exit arena simply hides the challenge on local client state
                          // Since state is synced in hook
                          chat.respondChallenge(chat.activeChallenge.challengeId, "decline");
                        }}
                        className="w-full py-2.5 rounded-xl bg-neutral-800 border border-white/10 hover:bg-neutral-700 font-bold text-xs transition"
                      >
                        Exit Arena
                      </button>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {isSettingsOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-lg rounded-2xl border border-white/10 bg-neutral-900/90 text-white p-6 shadow-2xl backdrop-blur-lg flex flex-col space-y-5"
            >
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <h3 className="text-md font-bold flex items-center gap-2">
                  <Settings size={18} className="text-indigo-400" />
                  Player Settings
                </h3>
                <IconButton label="Close Settings" onClick={() => setIsSettingsOpen(false)}>
                  <X size={18} />
                </IconButton>
              </div>

              <div className="space-y-4">
                {/* PM Block toggle */}
                <label className="flex items-center justify-between p-3 rounded-xl border border-white/5 bg-white/5 cursor-pointer hover:bg-white/10 transition">
                  <div>
                    <span className="text-xs font-semibold block">Block Private Messages (PMs)</span>
                    <span className="text-[10px] text-neutral-400">Prevent non-staff users from PMing you.</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={blockPMs}
                    onChange={(e) => setBlockPMs(e.target.checked)}
                    className="size-4 accent-indigo-500 rounded border-white/20 bg-neutral-800"
                  />
                </label>

                {/* Challenge Block toggle */}
                <label className="flex items-center justify-between p-3 rounded-xl border border-white/5 bg-white/5 cursor-pointer hover:bg-white/10 transition">
                  <div>
                    <span className="text-xs font-semibold block">Block Battle Challenges</span>
                    <span className="text-[10px] text-neutral-400">Ignore incoming duel invitations.</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={blockChallenges}
                    onChange={(e) => setBlockChallenges(e.target.checked)}
                    className="size-4 accent-indigo-500 rounded border-white/20 bg-neutral-800"
                  />
                </label>

                {/* Default Avatar list */}
                <div className="space-y-2">
                  <span className="text-xs font-semibold block">Choose Premium Avatar</span>
                  <div className="grid grid-cols-4 gap-2">
                    {DEFAULT_AVATARS.map((url, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setSelectedAvatar(url)}
                        className={`size-12 rounded-full border overflow-hidden p-0.5 transition ${
                          selectedAvatar === url ? "border-indigo-500 bg-indigo-500/20 scale-105" : "border-white/10 hover:border-white/30"
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt={`bottts-${i}`} className="w-full h-full rounded-full bg-neutral-800" />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom Avatar input */}
                <div className="space-y-2">
                  <span className="text-xs font-semibold block">Custom Avatar URL</span>
                  <input
                    type="url"
                    value={customAvatarUrl}
                    onChange={(e) => setCustomAvatarUrl(e.target.value)}
                    placeholder="https://example.com/avatar.jpg"
                    className="w-full text-xs rounded-lg border border-white/10 bg-neutral-850 p-2.5 outline-none focus:border-indigo-500 text-white placeholder-neutral-500"
                  />
                  <p className="text-[9px] text-neutral-400">Requires global rank or tournament wins. Overwrites default avatar choice.</p>
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-white/10 pt-4">
                <button
                  onClick={() => setIsSettingsOpen(false)}
                  className="px-4 py-2 text-xs font-semibold rounded-lg border border-white/10 hover:bg-white/5 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveSettings}
                  disabled={isSavingSettings}
                  className="px-5 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 transition flex items-center gap-1.5"
                >
                  {isSavingSettings ? <Loader2 size={12} className="animate-spin" /> : null}
                  Save Settings
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Private Messages Panel Overlay */}
      <AnimatePresence>
        {isPmOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-4xl h-[80vh] rounded-3xl border border-white/10 bg-neutral-950/95 text-white p-6 shadow-2xl backdrop-blur-lg flex flex-col md:flex-row gap-4 overflow-hidden"
            >
              {/* Left Column: Dialogs selection list */}
              <div className="w-full md:w-1/3 flex flex-col border-r border-white/5 pr-4 space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-white/5">
                  <h3 className="text-md font-bold flex items-center gap-2 text-indigo-400">
                    <MessageSquare size={18} /> Direct PMs
                  </h3>
                  <IconButton label="Close PM Panel" className="md:hidden" onClick={() => setIsPmOpen(false)}>
                    <X size={18} />
                  </IconButton>
                </div>
                
                <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
                  <span className="text-[10px] text-neutral-400 font-semibold block uppercase tracking-wider mb-2">Message Online Users</span>
                  {initialMembers
                    .filter(m => m.id !== currentUserId && chat.presence.some(p => p.userId === m.id && p.status === "online"))
                    .map(user => (
                      <button
                        key={user.id}
                        onClick={() => {
                          setSelectedPmUser(user.id);
                          void loadPmHistory(user.id);
                        }}
                        className={`w-full flex items-center gap-2 rounded-xl px-3 py-2 text-left transition text-xs border ${
                          selectedPmUser === user.id ? "bg-white/10 border-indigo-500/40 text-white" : "border-transparent hover:bg-white/5"
                        }`}
                      >
                        <span className="size-6 rounded-full bg-indigo-500/20 text-indigo-300 font-bold grid place-items-center uppercase">
                          {user.displayName[0]}
                        </span>
                        <span className="truncate flex-1 font-medium">{user.displayName}</span>
                        <span className="size-2 bg-emerald-500 rounded-full" />
                      </button>
                    ))}
                  {initialMembers.filter(m => m.id !== currentUserId && chat.presence.some(p => p.userId === m.id && p.status === "online")).length === 0 && (
                    <span className="text-[10px] text-neutral-500 block text-center py-4">No online members to message.</span>
                  )}
                </div>

                {/* ADMIN INTERCEPT SECTION */}
                {currentUser?.globalRole === "admin" && (
                  <div className="border-t border-white/10 pt-3 space-y-2 bg-neutral-900/45 p-3 rounded-xl border border-white/5">
                    <span className="text-[10px] text-amber-400 font-bold flex items-center gap-1">
                      <Shield size={12} /> Admin PM Intercept
                    </span>
                    <div className="space-y-2">
                      <select
                        value={adminUser1}
                        onChange={(e) => setAdminUser1(e.target.value)}
                        className="w-full text-[10px] bg-neutral-800 border border-white/10 rounded p-1 outline-none text-white"
                      >
                        <option value="">Select User A</option>
                        {initialMembers.map(m => (
                          <option key={m.id} value={m.id}>{m.displayName}</option>
                        ))}
                      </select>
                      <select
                        value={adminUser2}
                        onChange={(e) => setAdminUser2(e.target.value)}
                        className="w-full text-[10px] bg-neutral-800 border border-white/10 rounded p-1 outline-none text-white"
                      >
                        <option value="">Select User B</option>
                        {initialMembers.map(m => (
                          <option key={m.id} value={m.id}>{m.displayName}</option>
                        ))}
                      </select>
                      <button
                        onClick={handleInspect}
                        disabled={isInspecting || !adminUser1 || !adminUser2}
                        className="w-full py-1 bg-amber-600/30 hover:bg-amber-600/50 text-amber-200 border border-amber-500/20 text-[10px] font-bold rounded transition flex items-center justify-center gap-1"
                      >
                        {isInspecting ? <Loader2 size={10} className="animate-spin" /> : null}
                        Inspect Conversation
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Right Column: Dialogue Chat box */}
              <div className="flex-1 flex flex-col min-h-0 bg-neutral-900/20 border border-white/5 rounded-2xl p-4 relative">
                
                {/* Dialogue Header */}
                <div className="flex items-center justify-between pb-3 border-b border-white/5">
                  <div className="min-w-0">
                    {selectedPmUser ? (
                      <span className="text-sm font-semibold flex items-center gap-2">
                        💬 Conversing with <span className="text-indigo-400">{pmUserObj?.displayName ?? "User"}</span>
                      </span>
                    ) : (
                      <span className="text-sm font-medium text-neutral-400">Select an online user from the sidebar to chat</span>
                    )}
                  </div>
                  <IconButton label="Close PM Panel" className="hidden md:grid" onClick={() => setIsPmOpen(false)}>
                    <X size={18} />
                  </IconButton>
                </div>

                {/* Inspect vs Normal Logs render area */}
                <div className="flex-1 overflow-y-auto py-4 space-y-3 pr-1 text-xs max-h-[50vh]">
                  {currentUser?.globalRole === "admin" && inspectedHistory.length > 0 && (
                    <div className="mb-4 p-2 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                      <p className="text-[10px] text-amber-400 font-bold mb-2">🕵️ ADMIN INTERCEPT LOG:</p>
                      <div className="space-y-2">
                        {inspectedHistory.map((m) => {
                          const sender = initialMembers.find(usr => usr.id === m.senderId);
                          return (
                            <div key={m.id} className="p-1.5 bg-black/30 rounded border border-white/5">
                              <span className="font-semibold text-amber-300 text-[10px]">{sender?.displayName ?? "System"}: </span>
                              <span className="text-neutral-300 font-mono text-[10px]">{m.body}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {selectedPmUser ? (
                    activePmHistory.map((m) => {
                      const isMe = m.senderId === currentUserId;
                      return (
                        <div key={m.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[75%] px-3 py-2 rounded-xl border text-xs leading-relaxed ${
                            isMe
                              ? "bg-indigo-600/30 border-indigo-500/30 text-white rounded-tr-none"
                              : "bg-white/5 border-white/10 text-neutral-200 rounded-tl-none"
                          }`}>
                            <p className="break-words">{m.body}</p>
                            <span className="text-[8px] text-neutral-400 block mt-1 text-right">
                              {new Date(m.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center text-neutral-500 py-12">No active message thread.</div>
                  )}
                  <div ref={pmEndRef} />
                </div>

                {/* PM Composer Input */}
                {selectedPmUser && (
                  <div className="flex gap-2 pt-3 border-t border-white/5">
                    <input
                      type="text"
                      value={pmInput}
                      onChange={(e) => setPmInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSendPm()}
                      placeholder="Type private message..."
                      className="flex-1 text-xs rounded-xl border border-white/10 bg-neutral-900 px-3 py-2.5 outline-none focus:border-indigo-500 text-white placeholder-neutral-500"
                    />
                    <button
                      onClick={handleSendPm}
                      className="grid place-items-center size-9 bg-indigo-600 hover:bg-indigo-700 rounded-xl transition text-white"
                    >
                      <Send size={15} />
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}

function SignOutButton() {
  return (
    <button
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        window.location.href = "/";
      }}
      className="flex w-full items-center justify-center gap-2 rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-xs font-semibold text-rose-400 transition hover:bg-white/10 shadow-sm"
    >
      Sign Out
    </button>
  );
}

function RoomDrawer({ activeRoomId, rooms, unreadCounts }: { activeRoomId: string; rooms: { id: string; name: string }[]; unreadCounts: Record<string, number> }) {
  return (
    <div className="space-y-2">
      <Link
        href={"/chat/new" as any}
        className="flex w-full items-center gap-3 rounded-xl border border-dashed border-white/10 hover:border-indigo-500/40 px-3 py-2.5 text-left text-xs transition hover:bg-white/5 text-indigo-400 font-semibold"
      >
        <span className="grid size-7 place-items-center rounded-lg bg-indigo-500/10">
          <Plus size={14} />
        </span>
        New Room
      </Link>
      {rooms.map((room) => {
        const count = unreadCounts[room.id] ?? 0;
        const isActive = room.id === activeRoomId;
        return (
          <Link
            key={room.id}
            href={`/chat/${room.id}` as any}
            prefetch={true}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs transition border ${
              isActive
                ? "bg-indigo-500/10 border-indigo-500/20 text-white font-semibold shadow-md"
                : "border-transparent text-neutral-400 hover:bg-white/5 hover:text-white"
            }`}
          >
            <span className={`grid size-7 place-items-center rounded-lg ${isActive ? "bg-indigo-500/20 text-indigo-300" : "bg-neutral-800 text-neutral-400"}`}>
              <Hash size={14} />
            </span>
            <span className="min-w-0 flex-1 truncate">{room.name}</span>
            {count > 0 ? (
              <span className="rounded-full bg-green-500/20 border border-green-500/30 px-1.5 py-0.5 text-[9px] font-bold text-green-400">
                {count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}

function MemberDrawer({
  onProfile,
  members,
  presence
}: {
  onProfile: (userId: string) => void;
  members: Member[];
  presence: PresenceState[];
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-white/5 pb-2">
        <h2 className="text-xs font-bold uppercase tracking-wider text-indigo-400">Online Staff & Users</h2>
        <Shield size={14} className="text-neutral-500" />
      </div>
      <div className="space-y-1.5 max-h-[80vh] overflow-y-auto pr-1">
        {members.map((member) => {
          const userPresence = presence.find((p) => p.userId === member.id);
          const isOnline = userPresence?.status === "online";
          
          // Helper to get rank name badge
          const rank = member.globalRole !== "user" ? member.globalRole : member.roomRole;

          return (
            <button
              key={member.id}
              onClick={() => onProfile(member.id)}
              className="w-full flex items-center gap-3 rounded-xl px-2 py-2 text-left transition border border-transparent hover:bg-white/5 hover:border-white/5"
            >
              <div className="relative">
                <div className={`grid size-9 place-items-center rounded-full text-xs font-bold ${
                  isOnline ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30" : "bg-neutral-800 text-neutral-600"
                }`}>
                  {isOnline ? member.displayName[0]?.toUpperCase() : "?"}
                </div>
                {isOnline && (
                  <span className="absolute bottom-0 right-0 size-2.5 bg-emerald-500 rounded-full border-2 border-neutral-900" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold flex items-center gap-1.5">
                  {isOnline ? member.displayName : "Offline User"}
                  {rank && rank !== "member" && rank !== "guest" && (
                    <span className="text-[8px] bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 rounded px-1 scale-90 uppercase">
                      {rank}
                    </span>
                  )}
                </span>
                <span className="block truncate text-[9px] text-neutral-400">
                  {isOnline ? "Online" : "Away"}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
