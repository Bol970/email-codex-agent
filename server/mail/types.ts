import type {
  AgentActionLog,
  InboxListResponse,
  MailDraft,
  MailEvent,
  MailMessage,
  MailThreadDetail,
  ThreadListResponse
} from "../../shared/types.js";

export type ThreadListOptions = {
  inboxId?: string;
  query?: string;
  labels?: string[];
  limit?: number;
  pageToken?: string;
};

export type ReplyPayload = {
  inboxId: string;
  text: string;
  html?: string | null;
  replyAll?: boolean;
};

export type DraftReplyPayload = ReplyPayload & {
  labels?: string[];
};

export type LabelPayload = {
  inboxId: string;
  addLabels?: string[];
  removeLabels?: string[];
};

export type MailEventHandler = (event: MailEvent) => void;

export interface MailGateway {
  readonly mode: "live" | "mock" | "needs_config";
  readonly hasCredentials: boolean;
  readonly selectedInboxId?: string;
  listInboxes(): Promise<InboxListResponse>;
  createInbox(displayName?: string): Promise<{ inboxId: string; address: string }>;
  listThreads(options: ThreadListOptions): Promise<ThreadListResponse>;
  getThread(threadId: string, inboxId?: string): Promise<MailThreadDetail>;
  sendReply(messageId: string, payload: ReplyPayload): Promise<MailMessage>;
  createDraftReply(messageId: string, payload: DraftReplyPayload): Promise<MailDraft>;
  sendDraft(draftId: string, inboxId: string): Promise<MailMessage>;
  deleteDraft(draftId: string, inboxId: string): Promise<void>;
  updateLabels(messageId: string, payload: LabelPayload): Promise<MailMessage>;
  listDrafts(inboxId: string): Promise<MailDraft[]>;
  logAction(action: AgentActionLog): Promise<AgentActionLog>;
  listActions(): Promise<AgentActionLog[]>;
  startRealtime(onEvent: MailEventHandler): Promise<void>;
  stopRealtime(): Promise<void>;
}
