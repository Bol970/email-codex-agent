import express from "express";
import cors from "cors";
import type { Request, Response, NextFunction } from "express";
import type { AppConfig } from "./config.js";
import { getCodexVersion } from "./codex/codex-client.js";
import type { CodexGateway } from "./codex/demo-codex-client.js";
import type { MailGateway } from "./mail/types.js";
import type { CodexStreamEvent, MailEvent, StatusResponse } from "../shared/types.js";
import type { SseHub } from "./sse.js";

export type AppDeps = {
  config: AppConfig;
  mail: MailGateway;
  codex: CodexGateway;
  mailHub: SseHub<MailEvent>;
  codexHub: SseHub<CodexStreamEvent>;
};

export function createApp(deps: AppDeps) {
  const app = express();
  const codexVersionPromise = deps.config.demoMode ? Promise.resolve("demo-codex") : getCodexVersion();

  app.use(cors());
  app.use(express.json({ limit: "4mb" }));

  app.get("/api/status", asyncRoute(async (_req, res) => {
    const codexVersion = await codexVersionPromise;
    const status: StatusResponse = {
      mode: deps.mail.mode,
      hasAgentMailKey: deps.mail.hasCredentials,
      selectedInboxId: deps.mail.selectedInboxId ?? null,
      blurEmailAddresses: deps.config.blurEmailAddresses,
      codexAvailable: Boolean(codexVersion),
      codexVersion,
      message:
        deps.mail.mode === "needs_config"
          ? "Set AGENTMAIL_API_KEY in .env.local or run with MOCK_MODE=1."
          : undefined
    };
    res.json(status);
  }));

  app.get("/api/events", (_req, res) => deps.mailHub.connect(res));
  app.get("/api/codex/events", (_req, res) => deps.codexHub.connect(res));

  app.get("/api/inboxes", asyncRoute(async (_req, res) => {
    res.json(await deps.mail.listInboxes());
  }));

  app.post("/api/inboxes", asyncRoute(async (req, res) => {
    res.status(201).json(await deps.mail.createInbox(req.body?.displayName));
  }));

  app.get("/api/threads", asyncRoute(async (req, res) => {
    const labels = parseLabels(req.query.labels);
    const response = await deps.mail.listThreads({
      inboxId: asString(req.query.inboxId) ?? deps.mail.selectedInboxId,
      query: asString(req.query.query),
      labels,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      pageToken: asString(req.query.pageToken)
    });
    res.json(response);
  }));

  app.get("/api/threads/:id", asyncRoute(async (req, res) => {
    res.json(await deps.mail.getThread(req.params.id, asString(req.query.inboxId)));
  }));

  app.get("/api/drafts", asyncRoute(async (req, res) => {
    const inboxId = asString(req.query.inboxId) ?? deps.mail.selectedInboxId;
    if (!inboxId) throw new HttpError(400, "Missing inboxId");
    res.json({ drafts: await deps.mail.listDrafts(inboxId) });
  }));

  app.post("/api/messages/:id/reply", asyncRoute(async (req, res) => {
    const message = await deps.mail.sendReply(req.params.id, {
      inboxId: requireBodyString(req, "inboxId"),
      text: requireBodyString(req, "text"),
      html: req.body.html ?? null,
      replyAll: Boolean(req.body.replyAll)
    });
    deps.mailHub.publish({ type: "mail.message_sent", message });
    res.status(201).json(message);
  }));

  app.post("/api/messages/:id/draft-reply", asyncRoute(async (req, res) => {
    const draft = await deps.mail.createDraftReply(req.params.id, {
      inboxId: requireBodyString(req, "inboxId"),
      text: requireBodyString(req, "text"),
      html: req.body.html ?? null,
      replyAll: Boolean(req.body.replyAll),
      labels: Array.isArray(req.body.labels) ? req.body.labels.map(String) : ["drafted"]
    });
    res.status(201).json(draft);
  }));

  app.post("/api/drafts/:id/send", asyncRoute(async (req, res) => {
    const message = await deps.mail.sendDraft(req.params.id, requireBodyString(req, "inboxId"));
    deps.mailHub.publish({ type: "mail.message_sent", message });
    res.status(201).json(message);
  }));

  app.delete("/api/drafts/:id", asyncRoute(async (req, res) => {
    await deps.mail.deleteDraft(req.params.id, requireBodyString(req, "inboxId"));
    res.status(204).end();
  }));

  app.patch("/api/messages/:id/labels", asyncRoute(async (req, res) => {
    const message = await deps.mail.updateLabels(req.params.id, {
      inboxId: requireBodyString(req, "inboxId"),
      addLabels: Array.isArray(req.body.addLabels) ? req.body.addLabels.map(String) : undefined,
      removeLabels: Array.isArray(req.body.removeLabels) ? req.body.removeLabels.map(String) : undefined
    });
    deps.mailHub.publish({ type: "mail.updated", message });
    res.json(message);
  }));

  app.get("/api/actions", asyncRoute(async (_req, res) => {
    res.json({ actions: await deps.mail.listActions() });
  }));

  app.get("/api/codex/account", asyncRoute(async (_req, res) => {
    res.json(await deps.codex.accountRead());
  }));

  app.post("/api/codex/login/chatgpt", asyncRoute(async (_req, res) => {
    res.status(202).json(await deps.codex.loginChatgpt());
  }));

  app.post("/api/codex/login/device-code", asyncRoute(async (_req, res) => {
    res.status(202).json(await deps.codex.loginDeviceCode());
  }));

  app.post("/api/codex/thread", asyncRoute(async (_req, res) => {
    res.status(201).json(await deps.codex.startThread());
  }));

  app.post("/api/codex/turn", asyncRoute(async (req, res) => {
    const threadId = requireBodyString(req, "threadId");
    const mailThreadId = asString(req.body.mailThreadId);
    const mailThread = mailThreadId
      ? await deps.mail.getThread(mailThreadId, asString(req.body.inboxId))
      : null;
    res.status(202).json(
      await deps.codex.startTurn({
        threadId,
        prompt: String(req.body.prompt ?? ""),
        preset: req.body.preset,
        mailThread
      })
    );
  }));

  app.post("/api/codex/approval", asyncRoute(async (req, res) => {
    const requestId = req.body.requestId;
    if (requestId === undefined || requestId === null) throw new HttpError(400, "Missing requestId");
    res.json(await deps.codex.resolveApproval(requestId, req.body));
  }));

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : String(error);
    if (status >= 500) console.error(error);
    res.status(status).json({ error: message });
  });

  return app;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

function asyncRoute(handler: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function parseLabels(value: unknown): string[] | undefined {
  const raw = asString(value);
  if (!raw) return undefined;
  return raw
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
}

function requireBodyString(req: Request, key: string): string {
  const value = asString(req.body?.[key]);
  if (!value) throw new HttpError(400, `Missing ${key}`);
  return value;
}
