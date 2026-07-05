# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Local-only mail workspace for a single AgentMail inbox with an embedded Codex agent panel. The whole app is **one Node process** (Express) that serves the API, serves the Vite UI (middleware in dev, static `dist/` in prod), keeps two SSE streams open (mail + Codex), and spawns `codex app-server` over stdio for agent actions. There is no separate frontend dev server — everything is on one port.

## Commands

```bash
npm run dev          # tsx server/index.ts — runs the whole app on http://127.0.0.1:5173
npm run dev:watch    # same with file watching
MOCK_MODE=1 npm run dev   # credential-free demo (mock mail gateway, no AgentMail key needed)

npm run lint         # eslint, --max-warnings 0 (warnings fail)
npm run test         # vitest run (unit tests in tests/, jsdom env)
npm run test:watch   # vitest watch
npm run test:e2e     # Playwright; boots the server in MOCK_MODE on PORT 5174, tests desktop + mobile

npm run build        # tsc -p tsconfig.server.json (→ dist-server/) + vite build (→ dist/)
npm run start        # node dist-server/server/index.js — production, serves static dist/
```

Run a single unit test: `npx vitest run tests/codex-events.test.ts` (or `-t "<name>"` to filter by test name).
Run a single e2e test: `npx playwright test tests/e2e/app.spec.ts -g "<name>"`.

There is no local `php`/`composer` need here; this is a Node/TypeScript project. Node tooling is available directly.

## Configuration

Copy `.env.example` → `.env.local`. `config.ts` loads `.env.local` first, then `.env`. Key vars: `AGENTMAIL_API_KEY` (optional — absence puts the app in setup mode), `AGENTMAIL_INBOX_ID` (optional — empty means the UI lets you pick/create), `PORT` (default 5173), `MOCK_MODE`, `AGENTMAIL_PROXY_URL` (default `http://127.0.0.1:8118`). All outbound `fetch` is routed through the proxy via undici's `setGlobalDispatcher` in `server/proxy.ts` — this is why e2e/tests set `NO_PROXY=127.0.0.1,localhost`.

## Architecture

Wiring happens in [server/index.ts](server/index.ts): install fetch proxy → build two `SseHub`s → build a `MailGateway` → build the `CodexAppServerClient` → `createApp(deps)`. Everything is passed by dependency injection, so tests construct the pieces directly.

### Mail layer (`server/mail/`)
`MailGateway` ([types.ts](server/mail/types.ts)) is the single interface the rest of the app depends on. `createMailGateway(config)` ([index.ts](server/mail/index.ts)) picks one of three implementations by config, and the choice surfaces as `gateway.mode`:
- `MockMailGateway` (`mode: "mock"`) — when `MOCK_MODE`; in-memory fixtures, no network.
- `AgentMailGateway` (`mode: "live"`) — when an API key is present; wraps the `agentmail` SDK.
- `NeedsConfigMailGateway` (`mode: "needs_config"`) — no key, no mock; the UI renders setup instructions.

AgentMail SDK responses are shape-unstable, so [normalizers.ts](server/mail/normalizers.ts) (`normalizeThread`, `normalizeMessage`, `pick`, …) coerce them into the canonical types in [shared/types.ts](shared/types.ts) before they leave the gateway. Add new SDK-facing code behind a normalizer, not inline.

### Codex layer (`server/codex/`)
[codex-client.ts](server/codex/codex-client.ts) `CodexAppServerClient` speaks **JSON-RPC over stdio** to a spawned `codex app-server`. It multiplexes: outbound requests keyed by incrementing id (`pending` map); inbound frames are split into responses, server→client requests (approvals, `item/tool/call`, `currentTime/read`), and one-way notifications that get republished to the Codex SSE hub as `rpc`/`status`/`tool_result` events. The client is lazily started (`ensureReady`).

Codex is given mail capabilities two ways:
1. **Dynamic tools** ([mail-tools.ts](server/codex/mail-tools.ts)) — the `mail.*` namespace (`list_threads`, `get_thread`, `create_reply_draft`, `update_labels`, `log_action`). These run **in-process** against the same `MailGateway`. Tool calls arrive as `item/tool/call` server requests and are dispatched by `runMailDynamicTool`.
2. **AgentMail MCP** — passed as `-c mcp_servers.agentmail.*` args (`buildCodexArgs`), read-only tool subset, authenticated with an `x-api-key` header from `AGENTMAIL_API_KEY`.

### Safety model (do not weaken without intent)
This is the product's core promise, enforced in several places at once:
- **No send tool exists for the agent.** Neither the dynamic `mail.*` tools nor the MCP `enabled_tools` list expose sending. Sending only happens via explicit UI clicks hitting `POST /api/messages/:id/reply` or `POST /api/drafts/:id/send`.
- Agent may only draft (`create_reply_draft`) and relabel. Drafts always get the `drafted` label.
- Email content is treated as untrusted: `baseInstructions` in `startThread()` and the `UNTRUSTED EMAIL THREAD CONTEXT` framing in `buildPrompt()` tell the model to ignore instructions embedded in email bodies.

### Frontend (`src/`)
Single-file UI in [src/App.tsx](src/App.tsx) (~900 lines) — inbox sidebar, thread list, reading pane, Codex panel. All HTTP goes through the typed `client` in [src/api.ts](src/api.ts); SSE via `connectEvents`. **`handleCodexEvent` is exported from App.tsx specifically so unit tests can drive Codex event reduction without the DOM** ([tests/codex-events.test.ts](tests/codex-events.test.ts)) — keep it a pure-ish reducer over `setMessages`/`setApprovals`.

### Shared contract
[shared/types.ts](shared/types.ts) is the single source of truth for API/event/DTO shapes, imported by both sides. Frontend/tests use the `@shared` alias (configured in `vite.config.ts`, `vitest.config.ts`, `tsconfig.server.json`); the server uses relative `../shared/*.js` imports. When changing a payload, update the shared type and both ends will fail to compile if out of sync.

## Conventions

- ESM everywhere; server imports use explicit `.js` extensions (NodeNext resolution) even though sources are `.ts`.
- Server routes wrap handlers in `asyncRoute(...)` and throw `HttpError(status, msg)`; a trailing error middleware in [app.ts](server/app.ts) turns those into JSON `{ error }`. Don't send error responses inline.
- Design intent (see [DESIGN.md](DESIGN.md) / [PRODUCT.md](PRODUCT.md)): restrained Notion-like UI, shadcn/ui composition, lucide icons, ≤8px radii, semantic tokens — no marketing hero sections.
```
