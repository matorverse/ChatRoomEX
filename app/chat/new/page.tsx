"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewRoomPage() {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    
    if (res.ok) {
      const data = await res.json();
      router.push(`/chat/${data.room.id}` as any);
    } else {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4 bg-surface dark:bg-surface-dark">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-border-soft bg-surface p-6 shadow-soft dark:border-border-soft-dark dark:bg-panel-dark">
        <h1 className="text-xl font-semibold mb-2">Create a Room</h1>
        <p className="text-sm text-muted dark:text-muted-dark mb-5">Start a new conversation space.</p>
        
        <label className="block text-sm font-medium mb-4">
          Room Name
          <input
            autoFocus
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 h-11 w-full rounded-xl border border-border-soft bg-transparent px-3 outline-none focus:border-blue-strong dark:border-border-soft-dark"
            placeholder="e.g. Design Team"
          />
        </label>
        
        <button
          type="submit"
          disabled={loading || !name.trim()}
          className="h-11 w-full rounded-xl bg-blue-strong font-semibold text-white disabled:opacity-50"
        >
          {loading ? "Creating..." : "Create Room"}
        </button>
      </form>
    </main>
  );
}
