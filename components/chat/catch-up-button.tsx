"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";
import type { CatchUpSummary } from "@/lib/ai/catch-up";
import type { ChatMessage } from "@/lib/realtime/events";

export function CatchUpButton({ messages, unreadCount }: { messages: ChatMessage[]; unreadCount: number }) {
  const [summary, setSummary] = useState<CatchUpSummary | null>(null);
  const [loading, setLoading] = useState(false);

  if (unreadCount <= 50) return null;

  async function summarize() {
    setLoading(true);
    try {
      const response = await fetch("/api/ai/catch-up", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ unread: messages.slice(-Math.min(messages.length, 120)) })
      });
      if (response.ok) {
        setSummary((await response.json()) as CatchUpSummary);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative">
      <button
        className="inline-flex h-11 items-center gap-2 rounded-full bg-yellow-soft/70 px-3 text-sm font-medium text-ink transition active:scale-95"
        onClick={summarize}
        disabled={loading}
      >
        <Sparkles size={16} />
        {loading ? "Summarizing" : "Catch up"}
      </button>
      {summary ? (
        <div className="glass-overlay absolute right-0 top-12 z-50 w-[min(82vw,340px)] rounded-2xl p-3">
          <ul className="space-y-2 text-sm leading-5">
            {summary.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
          {summary.actionItems.length > 0 ? (
            <div className="mt-3 border-t border-border-soft pt-3 text-xs dark:border-border-soft-dark">
              <p className="font-semibold">Action items</p>
              <p className="mt-1 text-muted dark:text-muted-dark">{summary.actionItems.join(" • ")}</p>
            </div>
          ) : null}
          <p className="mt-3 text-xs text-muted dark:text-muted-dark">Sentiment: {summary.sentiment}</p>
        </div>
      ) : null}
    </div>
  );
}
