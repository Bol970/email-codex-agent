export type AppMode = "live" | "mock" | "needs_config";

export type AgentLabel =
  | "needs-reply"
  | "drafted"
  | "waiting"
  | "important"
  | "done"
  | string;

export type MailAddress = {
  email: string;
  name?: string | null;
};

export type MailAttachment = {
  attachmentId: string;
  filename: string;
  contentType?: string | null;
  size?: number | null;
};

export type MailMessage = {
  messageId: string;
  threadId: string;
  inboxId: string;
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  subject: string;
  text: string;
  html?: string | null;
  extractedText?: string | null;
  extractedHtml?: string | null;
  date: string;
  labels: AgentLabel[];
  attachments: MailAttachment[];
  direction: "inbound" | "outbound";
};

export type MailThreadSummary = {
  threadId: string;
  inboxId?: string | null;
  subject: string;
  preview: string;
  participants: MailAddress[];
  lastMessageAt: string;
  labels: AgentLabel[];
  messageCount: number;
  unread: boolean;
  priority?: "low" | "normal" | "high" | "urgent";
};

export type MailThreadDetail = MailThreadSummary & {
  messages: MailMessage[];
};

export type MailDraft = {
  draftId: string;
  inboxId: string;
  messageId?: string | null;
  threadId?: string | null;
  to: MailAddress[];
  subject: string;
  text: string;
  html?: string | null;
  labels: AgentLabel[];
  createdAt: string;
  sendAt?: string | null;
};

export type AgentActionLog = {
  id: string;
  at: string;
  action:
    | "summarize"
    | "draft_reply"
    | "classify"
    | "extract_actions"
    | "related_threads"
    | "follow_up"
    | "briefing"
    | "translate_ru"
    | "labels"
    | "manual_reply"
    | "draft_send";
  threadId?: string | null;
  messageId?: string | null;
  status: "proposed" | "approved" | "completed" | "failed" | "declined";
  summary: string;
  result?: unknown;
};

export type CodexStreamEvent =
  | {
      type: "status";
      status: "idle" | "starting" | "ready" | "error" | "closed";
      message?: string;
    }
  | {
      type: "rpc";
      method: string;
      params?: unknown;
    }
  | {
      type: "response";
      id: string | number;
      result?: unknown;
      error?: { code?: number; message: string };
    }
  | {
      type: "approval_request";
      request: ApprovalRequest;
    }
  | {
      type: "tool_result";
      requestId: string | number;
      tool?: string | null;
      ok: boolean;
      result?: unknown;
      error?: string;
    };

export type ApprovalRequest = {
  id: string | number;
  method: string;
  threadId?: string | null;
  turnId?: string | null;
  itemId?: string | null;
  title: string;
  reason?: string | null;
  command?: string | null;
  payload: unknown;
  availableDecisions: string[];
};

export type StatusResponse = {
  mode: AppMode;
  hasAgentMailKey: boolean;
  selectedInboxId?: string | null;
  blurEmailAddresses: boolean;
  codexAvailable: boolean;
  codexVersion?: string | null;
  message?: string;
};

export type ThreadListResponse = {
  threads: MailThreadSummary[];
  count: number;
  nextPageToken?: string | null;
};

export type InboxSummary = {
  inboxId: string;
  address: string;
  displayName?: string | null;
};

export type InboxListResponse = {
  inboxes: InboxSummary[];
};

export type PresetAction =
  | "summarize"
  | "draft_reply"
  | "classify"
  | "extract_actions"
  | "related_threads"
  | "follow_up"
  | "briefing"
  | "translate_ru";

export type MailEvent =
  | {
      type: "mail.message_received" | "mail.message_sent" | "mail.updated";
      message?: MailMessage;
      thread?: MailThreadSummary;
    }
  | {
      type: "agent.action";
      action: AgentActionLog;
    };
