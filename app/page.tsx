import { Suspense } from "react";
import { ChatShell } from "@/components/layout/chat-shell";

export default function HomePage() {
  return (
    <main className="min-h-dvh">
      <Suspense fallback={<div className="p-6 text-sm text-muted">Opening rooms...</div>}>
        <ChatShell />
      </Suspense>
    </main>
  );
}
