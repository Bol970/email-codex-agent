import { nanoid } from "nanoid";
import type {
  AgentActionLog,
  InboxListResponse,
  MailAddress,
  MailDraft,
  MailEvent,
  MailMessage,
  MailThreadDetail,
  MailThreadSummary,
  ThreadListResponse
} from "../../shared/types.js";
import type {
  DraftReplyPayload,
  LabelPayload,
  MailEventHandler,
  MailGateway,
  ReplyPayload,
  ThreadListOptions
} from "./types.js";

const inboxId = "local-agent@agentmail.to";

export class MockMailGateway implements MailGateway {
  readonly mode = "mock" as const;
  readonly hasCredentials = false;
  readonly selectedInboxId = inboxId;

  private threads: MailThreadDetail[];
  private drafts: MailDraft[] = [];
  private actions: AgentActionLog[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor() {
    this.threads = seedThreads();
  }

  async listInboxes(): Promise<InboxListResponse> {
    return {
      inboxes: [{ inboxId, address: inboxId, displayName: "Local Agent" }]
    };
  }

  async createInbox(displayName = "Local Agent") {
    return { inboxId, address: inboxId, displayName };
  }

  async listThreads(options: ThreadListOptions): Promise<ThreadListResponse> {
    const labels = options.labels ?? [];
    const query = options.query?.trim().toLowerCase();
    const limit = options.limit ?? 30;
    const filtered = this.threads
      .filter((thread) => labels.length === 0 || labels.every((label) => thread.labels.includes(label)))
      .filter((thread) => {
        if (!query) return true;
        return [thread.subject, thread.preview, ...thread.participants.map((p) => p.email)]
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
      .sort((a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt));

    return {
      threads: filtered.slice(0, limit).map(toSummary),
      count: filtered.length,
      nextPageToken: null
    };
  }

  async getThread(threadId: string): Promise<MailThreadDetail> {
    const thread = this.threads.find((item) => item.threadId === threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);
    return structuredClone(thread);
  }

  async sendReply(messageId: string, payload: ReplyPayload): Promise<MailMessage> {
    const thread = this.findThreadByMessage(messageId);
    const source = thread.messages.find((message) => message.messageId === messageId);
    const message = makeMessage({
      threadId: thread.threadId,
      from: { email: payload.inboxId },
      to: source ? [source.from] : [{ email: "recipient@example.com" }],
      subject: thread.subject,
      text: payload.text,
      html: payload.html,
      direction: "outbound",
      labels: ["sent"]
    });
    thread.messages.push(message);
    this.refreshThread(thread);
    await this.logAction({
      id: nanoid(),
      at: new Date().toISOString(),
      action: "manual_reply",
      threadId: thread.threadId,
      messageId,
      status: "completed",
      summary: "Manual reply sent in mock mode",
      result: { messageId: message.messageId }
    });
    return structuredClone(message);
  }

  async createDraftReply(messageId: string, payload: DraftReplyPayload): Promise<MailDraft> {
    const thread = this.findThreadByMessage(messageId);
    const source = thread.messages.find((message) => message.messageId === messageId);
    const draft: MailDraft = {
      draftId: `draft_${nanoid(10)}`,
      inboxId: payload.inboxId,
      messageId,
      threadId: thread.threadId,
      to: source ? [source.from] : [{ email: "recipient@example.com" }],
      subject: thread.subject.startsWith("Re:") ? thread.subject : `Re: ${thread.subject}`,
      text: payload.text,
      html: payload.html,
      labels: ["drafted", ...(payload.labels ?? [])],
      createdAt: new Date().toISOString(),
      sendAt: null
    };
    this.drafts.unshift(draft);
    await this.logAction({
      id: nanoid(),
      at: new Date().toISOString(),
      action: "draft_reply",
      threadId: thread.threadId,
      messageId,
      status: "completed",
      summary: "Reply draft created",
      result: { draftId: draft.draftId }
    });
    return structuredClone(draft);
  }

  async sendDraft(draftId: string, inbox: string): Promise<MailMessage> {
    const draft = this.drafts.find((item) => item.draftId === draftId && item.inboxId === inbox);
    if (!draft) throw new Error(`Draft not found: ${draftId}`);
    const thread = this.threads.find((item) => item.threadId === draft.threadId);
    if (!thread) throw new Error(`Draft thread not found: ${draft.threadId}`);
    const message = makeMessage({
      threadId: thread.threadId,
      from: { email: draft.inboxId },
      to: draft.to,
      subject: draft.subject,
      text: draft.text,
      html: draft.html,
      direction: "outbound",
      labels: ["sent"]
    });
    thread.messages.push(message);
    this.drafts = this.drafts.filter((item) => item.draftId !== draftId);
    this.refreshThread(thread);
    await this.logAction({
      id: nanoid(),
      at: new Date().toISOString(),
      action: "draft_send",
      threadId: thread.threadId,
      messageId: message.messageId,
      status: "approved",
      summary: "Draft sent after explicit approval",
      result: { draftId, messageId: message.messageId }
    });
    return structuredClone(message);
  }

  async deleteDraft(draftId: string, inbox: string): Promise<void> {
    this.drafts = this.drafts.filter((item) => !(item.draftId === draftId && item.inboxId === inbox));
  }

  async updateLabels(messageId: string, payload: LabelPayload): Promise<MailMessage> {
    const thread = this.findThreadByMessage(messageId);
    const message = thread.messages.find((item) => item.messageId === messageId);
    if (!message) throw new Error(`Message not found: ${messageId}`);
    const remove = new Set(payload.removeLabels ?? []);
    const add = payload.addLabels ?? [];
    message.labels = [...new Set(message.labels.filter((label) => !remove.has(label)).concat(add))];
    thread.labels = [...new Set(thread.messages.flatMap((item) => item.labels))];
    this.refreshThread(thread);
    await this.logAction({
      id: nanoid(),
      at: new Date().toISOString(),
      action: "labels",
      threadId: thread.threadId,
      messageId,
      status: "completed",
      summary: `Updated labels: +${add.join(", ")} -${[...remove].join(", ")}`
    });
    return structuredClone(message);
  }

  async listDrafts(inbox: string): Promise<MailDraft[]> {
    return structuredClone(this.drafts.filter((item) => item.inboxId === inbox));
  }

  async logAction(action: AgentActionLog): Promise<AgentActionLog> {
    this.actions.unshift(action);
    return structuredClone(action);
  }

  async listActions(): Promise<AgentActionLog[]> {
    return structuredClone(this.actions);
  }

  async startRealtime(onEvent: MailEventHandler): Promise<void> {
    if (this.timer) return;
    this.timer = setInterval(() => {
      onEvent({
        type: "mail.updated",
        thread: toSummary(this.threads[0])
      } satisfies MailEvent);
    }, 30000);
  }

  async stopRealtime(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private findThreadByMessage(messageId: string): MailThreadDetail {
    const thread = this.threads.find((item) =>
      item.messages.some((message) => message.messageId === messageId)
    );
    if (!thread) throw new Error(`Message not found: ${messageId}`);
    return thread;
  }

  private refreshThread(thread: MailThreadDetail) {
    const summary = toSummary(thread);
    Object.assign(thread, summary, { messages: thread.messages });
  }
}

function seedThreads(): MailThreadDetail[] {
  const now = Date.now();
  return [
    makeThread({
      threadId: "thr_launch",
      subject: "Pilot inbox: launch checklist",
      labels: ["needs-reply", "important"],
      at: new Date(now - 1000 * 60 * 8).toISOString(),
      from: "maya@agentmail.to",
      text:
        "Can you confirm the local agent can summarize incoming threads, prepare draft replies, and keep sending behind approval?"
    }),
    makeThread({
      threadId: "thr_invoice",
      subject: "Invoice question for July",
      labels: ["waiting", "unread"],
      at: new Date(now - 1000 * 60 * 60 * 3).toISOString(),
      from: "finance@example.com",
      text:
        "We received the July invoice and need the PO number before Friday. Can you send the reference and billing contact?"
    }),
    makeThread({
      threadId: "thr_design",
      subject: "Feedback on the email workspace UI",
      labels: ["done"],
      at: new Date(now - 1000 * 60 * 60 * 23).toISOString(),
      from: "design@example.com",
      text:
        "The split-pane direction works. Keep density high, avoid ornamental hero sections, and make the agent panel feel like a focused working surface."
    })
  ];
}

function makeThread(input: {
  threadId: string;
  subject: string;
  labels: string[];
  at: string;
  from: string;
  text: string;
}): MailThreadDetail {
  const message = makeMessage({
    threadId: input.threadId,
    from: { email: input.from },
    to: [{ email: inboxId }],
    subject: input.subject,
    text: input.text,
    labels: input.labels,
    date: input.at,
    direction: "inbound"
  });
  const thread: MailThreadDetail = {
    threadId: input.threadId,
    inboxId,
    subject: input.subject,
    preview: input.text,
    participants: [message.from, { email: inboxId }],
    lastMessageAt: input.at,
    labels: input.labels,
    messageCount: 1,
    unread: input.labels.includes("needs-reply"),
    priority: input.labels.includes("important") ? "high" : "normal",
    messages: [message]
  };
  return thread;
}

function makeMessage(input: {
  threadId: string;
  from: MailAddress;
  to: MailAddress[];
  subject: string;
  text: string;
  html?: string | null;
  labels: string[];
  date?: string;
  direction: "inbound" | "outbound";
}): MailMessage {
  return {
    messageId: `msg_${nanoid(10)}`,
    threadId: input.threadId,
    inboxId,
    from: input.from,
    to: input.to,
    cc: [],
    bcc: [],
    subject: input.subject,
    text: input.text,
    html: input.html ?? null,
    extractedText: input.text,
    extractedHtml: input.html ?? null,
    date: input.date ?? new Date().toISOString(),
    labels: input.labels,
    attachments: [],
    direction: input.direction
  };
}

function toSummary(thread: MailThreadDetail): MailThreadSummary {
  const last = thread.messages[thread.messages.length - 1];
  return {
    threadId: thread.threadId,
    inboxId: thread.inboxId,
    subject: thread.subject,
    preview: (last?.extractedText ?? last?.text ?? thread.preview).slice(0, 240),
    participants: thread.participants,
    lastMessageAt: last?.date ?? thread.lastMessageAt,
    labels: [...new Set(thread.labels)],
    messageCount: thread.messages.length,
    unread: thread.labels.includes("needs-reply") || thread.labels.includes("unread"),
    priority: thread.labels.includes("important") ? "high" : "normal"
  };
}
