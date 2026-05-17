import pino from "pino";

export const logger = pino({
  name: "chatroomex",
  level: process.env.LOG_LEVEL ?? "info",
  redact: ["req.headers.authorization", "password", "token", "refreshToken"]
});

export function withRequestContext(fields: Record<string, unknown>) {
  return logger.child(fields);
}
