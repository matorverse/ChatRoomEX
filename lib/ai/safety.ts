import { z } from "zod";

export const safetyDecisionSchema = z.object({
  allowed: z.boolean(),
  toxicityScore: z.number().min(0).max(1),
  spamScore: z.number().min(0).max(1),
  categories: z.array(z.string()).default([]),
  userFacingReason: z.string().optional()
});

export type SafetyDecision = z.infer<typeof safetyDecisionSchema>;

export async function classifyMessageSafety(body: string): Promise<SafetyDecision> {
  const repeated = /(.)\1{14,}/.test(body);
  const linkBurst = (body.match(/https?:\/\//g) ?? []).length > 3;

  return {
    allowed: !repeated && !linkBurst,
    toxicityScore: 0,
    spamScore: repeated || linkBurst ? 0.85 : 0.05,
    categories: repeated || linkBurst ? ["spam"] : [],
    userFacingReason: repeated || linkBurst ? "Message looks repetitive or spammy." : undefined
  };
}
