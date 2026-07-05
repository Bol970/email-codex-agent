# Local Email Codex Agent

Local-only mail workspace for one AgentMail inbox with an embedded Codex panel.
The app runs as a single Node service: Express serves the API and Vite UI, keeps
mail/Codex SSE streams open, and spawns `codex app-server` over stdio when agent
actions are requested.

## Quick Start

```bash
npm install
npm run dev
```

Open http://127.0.0.1:5173.

For a credential-free demo:

```bash
MOCK_MODE=1 npm run dev
```

## Configuration

Create `.env.local` from `.env.example`:

```bash
AGENTMAIL_API_KEY=am_your_key_here
AGENTMAIL_INBOX_ID=
PORT=5173
MOCK_MODE=0
AGENTMAIL_PROXY_URL=http://127.0.0.1:8118
```

`AGENTMAIL_INBOX_ID` is optional. If it is empty, the UI shows available inboxes.
Outbound AgentMail requests use `AGENTMAIL_PROXY_URL`; by default it points at
the local HTTP proxy on `127.0.0.1:8118`.

Codex uses the local `codex app-server` binary and your existing ChatGPT/Codex
login. If Codex is not authenticated, use the login controls in the right panel.
AgentMail MCP is passed to Codex with an `x-api-key` HTTP header when
`AGENTMAIL_API_KEY` is available.

## Safety Model

The v1 policy is draft-first:

- Codex can summarize, search, triage, draft replies, and propose labels.
- Codex does not get a send-mail tool.
- Sending a draft requires a visible user click in the UI.
- Agent actions are logged locally through `/api/codex/action-log`.

## Scripts

```bash
npm run lint
npm run test
npm run build
npm run test:e2e
npm run dev:watch
npm run start
```

`npm run test:e2e` starts the local server in mock mode and runs Playwright on
desktop and mobile viewports.
