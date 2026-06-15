import { NextResponse } from "next/server";
import { z } from "zod";
import { summarizeUnread } from "@/lib/ai/catch-up";
import { chatMessageSchema } from "@/lib/realtime/events";
import { getCurrentSession } from "@/lib/auth/session";

const requestSchema = z.object({
  unread: z.array(chatMessageSchema).min(1).max(300)
});

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid unread payload" }, { status: 400 });
  }

  const summary = await summarizeUnread(parsed.data.unread);
  return NextResponse.json(summary);
}
