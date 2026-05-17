const blocked = new Set(["slur-placeholder"]);

export type ModerationDecision = {
  allowed: boolean;
  reason?: string;
  normalized: string;
};

export function moderateMessage(body: string): ModerationDecision {
  const normalized = body.replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();

  for (const term of blocked) {
    if (lower.includes(term)) {
      return { allowed: false, reason: "Message did not pass room safety filters.", normalized };
    }
  }

  if (/(.)\1{14,}/.test(normalized)) {
    return { allowed: false, reason: "Message looks like spam.", normalized };
  }

  return { allowed: true, normalized };
}
