import { describe, expect, it } from "vitest";
import { moderateMessage } from "@/lib/security/moderation";
import { classifyMessageSafety } from "@/lib/ai/safety";

describe("message safety", () => {
  it("normalizes safe message whitespace", () => {
    expect(moderateMessage("  hello   team  ")).toEqual({ allowed: true, normalized: "hello team" });
  });

  it("rejects repetitive spam", async () => {
    const decision = await classifyMessageSafety("aaaaaaaaaaaaaaaaaaaaaaaa");
    expect(decision.allowed).toBe(false);
    expect(decision.spamScore).toBeGreaterThan(0.8);
  });
});
