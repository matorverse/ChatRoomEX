# 1. Complete directory structure

```text
app/
  api/ai/catch-up/route.ts
  globals.css
  layout.tsx
  page.tsx
components/
  chat/
  layout/
  ui/
lib/
  ai/
  auth/
  db/
  offline/
  realtime/
  security/
prisma/schema.prisma
realtime/src/server.ts
.github/workflows/ci.yml
Dockerfile.realtime
fly.toml
vercel.json
```

# 2. Database schema

The data model uses flattened RBAC through `room_members` with indexed UUID foreign keys, server timestamps, and no nested permission inheritance. Core tables are `users`, `rooms`, `room_members`, `messages`, `threads`, `reactions`, `notifications`, and `room_presence`.

# 3. Tailwind v4 globals.css with OKLCH theme

`app/globals.css` uses `@import "tailwindcss";`, `@theme`, OKLCH tokens, light/dark color support, reduced motion, high contrast, and glass overlay constraints capped at `blur(6px)`.

# 4. Socket architecture

`realtime/src/server.ts` runs a dedicated Socket.io service with JWT auth middleware, PostgreSQL authorization, Redis adapter support, sticky-session friendly recovery, room-scoped broadcasts, Redis-backed rate limiting, and structured Pino logs.

# 5. Realtime event flow

Client creates a `clientNonce`, renders optimistically, writes to IndexedDB, emits `message:send`, receives `message:ack`, replaces the temporary message, and removes queued offline work. Rejections emit `message:rollback`. Read receipts clear Redis unread counters and broadcast `read:receipt`; typing state is stored with a short Redis TTL.

# 6. Prisma schema

See `prisma/schema.prisma` for typed enums, flattened room permissions, contextual threads, reactions, notifications, and room presence.

# 7. IndexedDB sync layer

`lib/offline/db.ts` and `lib/offline/sync.ts` provide Dexie-backed local message hydration, offline queueing, reconnect flush, ACK reconciliation, and rollback state.

# 8. Core React layouts

`components/layout/chat-shell.tsx` is a server component that checks the HTTP-only session, loads the first authorized room, and streams initial messages. `components/auth/auth-panel.tsx` handles login/register. `components/chat/chat-experience.tsx` is the interactive island for mobile sliding panes, desktop columns, bottom navigation, thread overlays, micro-profiles, catch-up, and swipe navigation.

# 9. WebSocket hooks

`lib/realtime/use-chat-socket.ts` owns the Socket.io client lifecycle, reconnection, room joins, local hydration, message batching, typing indicators, and optimistic send API.

# 10. Virtualized chat implementation

`components/chat/virtualized-chat.tsx` uses `@tanstack/react-virtual` with overscan, transform-only row placement, scroll containment, and mobile-safe message actions.

# 11. AI summarization service

`lib/ai/catch-up.ts` calls Gemini through Vertex AI with JSON-mode output validated by Zod. `app/api/ai/catch-up/route.ts` exposes the unread catch-up endpoint for unread counts above 50. `lib/ai/safety.ts`, `lib/ai/semantic-search.ts`, and `lib/ai/translation.ts` provide typed extension points for abuse controls, search, and localization.

# 12. Deployment configuration

Vercel hosts the Next.js app via `vercel.json`. Fly.io or Cloud Run can run the websocket service from `Dockerfile.realtime`; `fly.toml` pins at least two machines for availability. CI runs install, Prisma generate, typecheck, unit tests, and build. `instrumentation.ts` initializes Sentry when `SENTRY_DSN` is present.

## Remaining production switches

Set `DATABASE_URL`, Redis variables, JWT secrets, and Vertex AI project settings before deployment. Run `npm.cmd run prisma:migrate` and `npm.cmd run prisma:seed` against a non-production environment first, then promote migrations through CI.

## Neon Postgres integration

Neon Postgres is the application database for auth sessions, users, rooms, RBAC, messages, threads, read receipts, notifications, and audit logs. Use the pooled Neon connection string for `DATABASE_URL` and the direct non-pooler connection string for `DIRECT_URL` so Prisma migrations can run safely.
