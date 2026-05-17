import { NextResponse } from "next/server";
import { z } from "zod";
import { summarizeUnread } from "@/lib/ai/catch-up";
import { chatMessageSchema } from "@/lib/realtime/events";

const requestSchema = z.object({
  unread: z.array(chatMessageSchema).min(1).max(300)
});

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid unread payload" }, { status: 400 });
  }

  const summary = await summarizeUnread(parsed.data.unread);
  return NextResponse.json(summary);
}
