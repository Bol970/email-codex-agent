import { nanoid } from "nanoid";
import type {
  AgentActionLog,
  InboxListResponse,
  MailDraft,
  MailEvent,
  MailMessage,
  MailThreadDetail,
  ThreadListResponse
} from "../../shared/types.js";
import {
  normalizeDraft,
  normalizeInbox,
  normalizeMessage,
  normalizeThread,
  normalizeThreadDetail,
  pick
} from "./normalizers.js";
import type {
  DraftReplyPayload,
  LabelPayload,
  MailEventHandler,
  MailGateway,
  ReplyPayload,
  ThreadListOptions
} from "./types.js";

type AgentMailClientLike = any;

export class AgentMailGateway implements MailGateway {
  readonly mode = "live" as const;
  readonly hasCredentials = true;
  readonly selectedInboxId?: string;

  private client?: AgentMailClientLike;
  private socket?: any;
  private readonly actions: AgentActionLog[] = [];

  constructor(
    private readonly apiKey: string,
    selectedInboxId?: string,
    private readonly injectedClient?: AgentMailClientLike
  ) {
    this.selectedInboxId = selectedInboxId;
  }

  async listInboxes(): Promise<InboxListResponse> {
    const client = await this.getClient();
    const response = await client.inboxes.list();
    const inboxes = (pick<any[]>(response, "inboxes", "data", "items") ?? response ?? []).map(normalizeInbox);
    return { inboxes };
  }

  async createInbox(displayName = "Email Codex Agent") {
    const client = await this.getClient();
    const created = await client.inboxes.create({
      displayName,
      clientId: `email-codex-agent-${displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
    });
    const inbox = normalizeInbox(created);
    return { inboxId: inbox.inboxId, address: inbox.address };
  }

  async listThreads(options: ThreadListOptions): Promise<ThreadListResponse> {
    const client = await this.getClient();
    const inbox = options.inboxId ?? this.selectedInboxId;
    const params = {
      limit: options.limit ?? 30,
      lastKey: options.pageToken,
      labels: options.labels
    };
    const response = await this.callThreadList(client, inbox, params);
    const rawThreads = pick<any[]>(response, "threads", "data", "items") ?? [];
    const normalizedThreads = rawThreads.map((thread) => normalizeThread(thread, inbox));
    const query = options.query?.trim().toLowerCase();
    const threads = query
      ? normalizedThreads.filter((thread) =>
          [thread.subject, thread.preview, thread.participants.map((p) => p.name ?? p.email).join(" ")]
            .join(" ")
            .toLowerCase()
            .includes(query)
        )
      : normalizedThreads;
    return {
      threads,
      count: Number(pick(response, "count", "total") ?? threads.length),
      nextPageToken: pick(response, "nextPageToken", "next_page_token", "lastKey", "last_key") ?? null
    };
  }

  async getThread(threadId: string, inboxId?: string): Promise<MailThreadDetail> {
    const client = await this.getClient();
    const inbox = inboxId ?? this.selectedInboxId;
    if (!inbox) throw new Error("Missing inboxId");
    const response = await client.threads.get(inbox, threadId);
    return normalizeThreadDetail(response, inbox);
  }

  async sendReply(messageId: string, payload: ReplyPayload): Promise<MailMessage> {
    const client = await this.getClient();
    const response = await client.messages.reply(payload.inboxId, messageId, {
      text: payload.text,
      html: payload.html ?? undefined,
      replyAll: payload.replyAll
    });
    const message = normalizeMessage(response, payload.inboxId);
    await this.logAction({
      id: nanoid(),
      at: new Date().toISOString(),
      action: "manual_reply",
      threadId: message.threadId,
      messageId,
      status: "completed",
      summary: "Manual reply sent",
      result: { messageId: message.messageId }
    });
    return message;
  }

  async createDraftReply(messageId: string, payload: DraftReplyPayload): Promise<MailDraft> {
    const client = await this.getClient();
    const response = await this.callFirst(
      [
        () =>
          client.inboxes?.messages?.draftReply(payload.inboxId, messageId, {
            text: payload.text,
            html: payload.html ?? undefined,
            labels: payload.labels
          }),
        () =>
          client.inboxes?.messages?.draft_reply(payload.inboxId, messageId, {
            text: payload.text,
            html: payload.html ?? undefined,
            labels: payload.labels
          }),
        () =>
          this.agentMailJson(
            "POST",
            `/v0/inboxes/${encodeURIComponent(payload.inboxId)}/messages/${encodeURIComponent(messageId)}/draft_reply`,
            {
              text: payload.text,
              html: payload.html ?? undefined,
              reply_all: payload.replyAll,
              labels: payload.labels
            }
          ),
        () =>
          this.agentMailJson(
            "POST",
            `/v0/inboxes/${encodeURIComponent(payload.inboxId)}/messages/${encodeURIComponent(messageId)}/draft-reply`,
            {
              text: payload.text,
              html: payload.html ?? undefined,
              reply_all: payload.replyAll,
              labels: payload.labels
            }
          )
      ],
      "AgentMail SDK does not expose draft reply"
    );
    const draft = normalizeDraft(response, payload.inboxId);
    await this.logAction({
      id: nanoid(),
      at: new Date().toISOString(),
      action: "draft_reply",
      threadId: draft.threadId,
      messageId,
      status: "completed",
      summary: "Reply draft created",
      result: { draftId: draft.draftId }
    });
    return draft;
  }

  async sendDraft(draftId: string, inboxId: string): Promise<MailMessage> {
    const client = await this.getClient();
    const response = await this.callFirst(
      [
        () => client.inboxes?.drafts?.send(inboxId, draftId),
        () => client.drafts?.send(inboxId, draftId),
        () => this.agentMailJson("POST", `/v0/inboxes/${encodeURIComponent(inboxId)}/drafts/${encodeURIComponent(draftId)}/send`)
      ],
      "AgentMail SDK does not expose draft send"
    );
    const message = normalizeMessage(response, inboxId);
    await this.logAction({
      id: nanoid(),
      at: new Date().toISOString(),
      action: "draft_send",
      threadId: message.threadId,
      messageId: message.messageId,
      status: "approved",
      summary: "Draft sent after explicit approval",
      result: { draftId }
    });
    return message;
  }

  async deleteDraft(draftId: string, inboxId: string): Promise<void> {
    const client = await this.getClient();
    await this.callFirst(
      [
        () => client.inboxes?.drafts?.delete(inboxId, draftId),
        () => client.inboxes?.drafts?.del(inboxId, draftId),
        () => client.inboxes?.drafts?.remove(inboxId, draftId),
        () => client.drafts?.delete(inboxId, draftId),
        () => this.agentMailJson("DELETE", `/v0/inboxes/${encodeURIComponent(inboxId)}/drafts/${encodeURIComponent(draftId)}`)
      ],
      "AgentMail SDK does not expose draft deletion"
    );
  }

  async updateLabels(messageId: string, payload: LabelPayload): Promise<MailMessage> {
    const client = await this.getClient();
    const response = await this.callFirst(
      [
        () =>
          client.inboxes?.messages?.update(payload.inboxId, messageId, {
            addLabels: payload.addLabels,
            removeLabels: payload.removeLabels,
            add_labels: payload.addLabels,
            remove_labels: payload.removeLabels
          }),
        () =>
          client.messages?.update(payload.inboxId, messageId, {
            addLabels: payload.addLabels,
            removeLabels: payload.removeLabels,
            add_labels: payload.addLabels,
            remove_labels: payload.removeLabels
          }),
        () =>
          this.agentMailJson(
            "PATCH",
            `/v0/inboxes/${encodeURIComponent(payload.inboxId)}/messages/${encodeURIComponent(messageId)}`,
            {
              add_labels: payload.addLabels,
              remove_labels: payload.removeLabels
            }
          )
      ],
      "AgentMail SDK does not expose message label update"
    );
    const message = normalizeMessage(response, payload.inboxId);
    await this.logAction({
      id: nanoid(),
      at: new Date().toISOString(),
      action: "labels",
      threadId: message.threadId,
      messageId,
      status: "completed",
      summary: `Updated labels: +${payload.addLabels?.join(", ") ?? ""} -${
        payload.removeLabels?.join(", ") ?? ""
      }`
    });
    return message;
  }

  async listDrafts(inboxId: string): Promise<MailDraft[]> {
    const client = await this.getClient();
    const response = await client.drafts.list(inboxId);
    return (pick<any[]>(response, "drafts", "data", "items") ?? []).map((item) => normalizeDraft(item, inboxId));
  }

  async logAction(action: AgentActionLog): Promise<AgentActionLog> {
    this.actions.unshift(action);
    return action;
  }

  async listActions(): Promise<AgentActionLog[]> {
    return [...this.actions];
  }

  async startRealtime(onEvent: MailEventHandler): Promise<void> {
    if (this.socket || !this.selectedInboxId) return;
    const client = await this.getClient();
    if (!client.websockets?.connect) return;

    this.socket = await client.websockets.connect();
    this.socket.on?.("open", () => {
      this.socket.sendSubscribe?.({
        type: "subscribe",
        inboxIds: [this.selectedInboxId],
        eventTypes: ["message.received", "message.sent"]
      });
    });
    this.socket.on?.("message", (event: any) => {
      const eventType = pick<string>(event, "eventType", "event_type", "type");
      const messageRaw = pick(event, "message");
      const message = messageRaw ? normalizeMessage(messageRaw, this.selectedInboxId) : undefined;
      if (eventType === "message_received" || eventType === "message.received") {
        onEvent({ type: "mail.message_received", message } satisfies MailEvent);
      } else if (eventType === "message_sent" || eventType === "message.sent") {
        onEvent({ type: "mail.message_sent", message } satisfies MailEvent);
      }
    });
  }

  async stopRealtime(): Promise<void> {
    this.socket?.close?.();
    this.socket = undefined;
  }

  private async getClient(): Promise<AgentMailClientLike> {
    if (this.injectedClient) return this.injectedClient;
    if (this.client) return this.client;
    const mod = await import("agentmail");
    const Client = mod.AgentMailClient ?? mod.AgentMail ?? mod.default;
    this.client = new Client({ apiKey: this.apiKey });
    return this.client;
  }

  private async callThreadList(client: AgentMailClientLike, inboxId: string | undefined, params: any) {
    if (!inboxId) throw new Error("Missing inboxId");
    return client.threads.list(inboxId, params);
  }

  private async callFirst<T>(calls: Array<() => Promise<T>>, message: string): Promise<T> {
    let lastError: unknown;
    for (const call of calls) {
      try {
        return await call();
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`${message}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  private async agentMailJson(method: string, path: string, body?: unknown): Promise<any> {
    const response = await fetch(`https://api.agentmail.to${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    const parsed = text ? tryJson(text) : undefined;
    if (!response.ok) {
      throw new Error(`AgentMail ${method} ${path} failed: ${response.status} ${text.slice(0, 500)}`);
    }
    return parsed ?? {};
  }
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export class NeedsConfigMailGateway implements MailGateway {
  readonly mode = "needs_config" as const;
  readonly hasCredentials = false;
  readonly selectedInboxId?: string;

  private fail(): never {
    throw new Error("AgentMail is not configured. Set AGENTMAIL_API_KEY in .env.local or use MOCK_MODE=1.");
  }

  async listInboxes(): Promise<InboxListResponse> {
    return { inboxes: [] };
  }
  async createInbox(): Promise<{ inboxId: string; address: string }> {
    this.fail();
  }
  async listThreads(): Promise<ThreadListResponse> {
    return { threads: [], count: 0, nextPageToken: null };
  }
  async getThread(): Promise<MailThreadDetail> {
    this.fail();
  }
  async sendReply(): Promise<MailMessage> {
    this.fail();
  }
  async createDraftReply(): Promise<MailDraft> {
    this.fail();
  }
  async sendDraft(): Promise<MailMessage> {
    this.fail();
  }
  async deleteDraft(): Promise<void> {
    this.fail();
  }
  async updateLabels(): Promise<MailMessage> {
    this.fail();
  }
  async listDrafts(): Promise<MailDraft[]> {
    return [];
  }
  async logAction(action: AgentActionLog): Promise<AgentActionLog> {
    return action;
  }
  async listActions(): Promise<AgentActionLog[]> {
    return [];
  }
  async startRealtime(): Promise<void> {}
  async stopRealtime(): Promise<void> {}
}
