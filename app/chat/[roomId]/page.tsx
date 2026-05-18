import { Suspense } from "react";
import { ChatShell } from "@/components/layout/chat-shell";

export default async function ChatPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  return (
    <main className="min-h-dvh">
      <Suspense fallback={<div className="p-6 text-sm text-muted">Loading room...</div>}>
        <ChatShell roomId={roomId} />
      </Suspense>
    </main>
  );
}
