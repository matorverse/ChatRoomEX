import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { AuthPanel } from "@/components/auth/auth-panel";

export default async function HomePage() {
  const session = await getCurrentSession();
  if (!session) {
    return <AuthPanel />;
  }

  const firstRoom = await prisma.room.findFirst({
    where: { members: { some: { userId: session.userId } } },
    select: { id: true },
    orderBy: { updatedAt: "desc" }
  });

  if (firstRoom) {
    redirect(`/chat/${firstRoom.id}` as any);
  }

  // If the user has no rooms, redirect to a default or show empty state
  redirect("/chat/new" as any);
}
