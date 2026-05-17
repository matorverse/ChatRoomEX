import { describe, expect, it } from "vitest";
import { sendMessageSchema } from "@/lib/realtime/events";

describe("realtime event contracts", () => {
  it("accepts valid optimistic message sends", () => {
    const parsed = sendMessageSchema.safeParse({
      roomId: "6f9d30f0-3f55-49af-8297-4d4f0a990001",
      body: "Ship the calm path.",
      clientNonce: "nonce-123456"
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects empty message sends", () => {
    const parsed = sendMessageSchema.safeParse({
      roomId: "6f9d30f0-3f55-49af-8297-4d4f0a990001",
      body: " ",
      clientNonce: "nonce-123456"
    });

    expect(parsed.success).toBe(false);
  });
});
