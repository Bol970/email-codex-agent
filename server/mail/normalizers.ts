import type {
  InboxSummary,
  MailAddress,
  MailAttachment,
  MailDraft,
  MailMessage,
  MailThreadDetail,
  MailThreadSummary
} from "../../shared/types.js";

export function pick<T = unknown>(obj: any, ...keys: string[]): T | undefined {
  if (!obj) return undefined;
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key] as T;
  }
  return undefined;
}

export function toAddress(value: any): MailAddress {
  if (!value) return { email: "unknown@example.invalid" };
  if (typeof value === "string") return { email: value };
  return {
    email: String(pick(value, "email", "address", "mail") ?? value.from ?? "unknown@example.invalid"),
    name: pick(value, "name", "displayName", "display_name") ?? null
  };
}

export function toAddressList(value: any): MailAddress[] {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map(toAddress);
}

export function normalizeInbox(raw: any): InboxSummary {
  const inboxId = String(pick(raw, "inboxId", "inbox_id", "id", "address") ?? "");
  return {
    inboxId,
    address: String(pick(raw, "address", "email", "inboxId", "inbox_id") ?? inboxId),
    displayName: pick(raw, "displayName", "display_name", "name") ?? null
  };
}

export function normalizeAttachment(raw: any): MailAttachment {
  return {
    attachmentId: String(pick(raw, "attachmentId", "attachment_id", "id") ?? ""),
    filename: String(pick(raw, "filename", "name") ?? "attachment"),
    contentType: pick(raw, "contentType", "content_type", "mimeType", "mime_type") ?? null,
    size: pick(raw, "size", "sizeBytes", "size_bytes") ?? null
  };
}

export function normalizeMessage(raw: any, fallbackInboxId?: string): MailMessage {
  const messageId = String(pick(raw, "messageId", "message_id", "id") ?? "");
  const threadId = String(pick(raw, "threadId", "thread_id") ?? "");
  const inboxId = String(pick(raw, "inboxId", "inbox_id") ?? fallbackInboxId ?? "");
  const fromValue = pick(raw, "from_", "from", "sender");
  const dateValue = pick(raw, "date", "createdAt", "created_at", "receivedAt", "received_at");
  const direction = pick<string>(raw, "direction") ?? (toAddress(fromValue).email === inboxId ? "outbound" : "inbound");

  return {
    messageId,
    threadId,
    inboxId,
    from: toAddress(fromValue),
    to: toAddressList(pick(raw, "to", "recipients")),
    cc: toAddressList(pick(raw, "cc")),
    bcc: toAddressList(pick(raw, "bcc")),
    subject: String(pick(raw, "subject") ?? "(no subject)"),
    text: String(pick(raw, "text", "body", "plainText", "plain_text") ?? ""),
    html: pick(raw, "html") ?? null,
    extractedText: pick(raw, "extractedText", "extracted_text") ?? null,
    extractedHtml: pick(raw, "extractedHtml", "extracted_html") ?? null,
    date: dateValue ? new Date(String(dateValue)).toISOString() : new Date().toISOString(),
    labels: normalizeLabels(pick(raw, "labels")),
    attachments: (pick<any[]>(raw, "attachments") ?? []).map(normalizeAttachment),
    direction: direction === "outbound" ? "outbound" : "inbound"
  };
}

export function normalizeThread(raw: any, fallbackInboxId?: string): MailThreadSummary {
  const messages = (pick<any[]>(raw, "messages") ?? []).map((message) =>
    normalizeMessage(message, fallbackInboxId)
  );
  const last = messages[messages.length - 1];
  const threadId = String(pick(raw, "threadId", "thread_id", "id") ?? last?.threadId ?? "");
  const inboxId = String(pick(raw, "inboxId", "inbox_id") ?? fallbackInboxId ?? last?.inboxId ?? "");
  const subject = String(pick(raw, "subject") ?? last?.subject ?? "(no subject)");
  const preview = String(
    pick(raw, "preview", "snippet") ??
      last?.extractedText ??
      last?.text ??
      ""
  ).slice(0, 240);
  const lastMessageAt =
    pick<string>(raw, "lastMessageAt", "last_message_at", "updatedAt", "updated_at") ??
    last?.date ??
    new Date().toISOString();
  const participants = pick<any[]>(raw, "participants")?.map(toAddress) ?? buildParticipants(messages);
  const labels = normalizeLabels(pick(raw, "labels") ?? last?.labels);
  const priority = labels.includes("urgent") ? "urgent" : labels.includes("important") ? "high" : "normal";

  return {
    threadId,
    inboxId,
    subject,
    preview,
    participants,
    lastMessageAt: new Date(lastMessageAt).toISOString(),
    labels,
    messageCount: Number(pick(raw, "messageCount", "message_count", "count") ?? messages.length ?? 0),
    unread: labels.includes("unread") || labels.includes("needs-reply"),
    priority
  };
}

export function normalizeThreadDetail(raw: any, fallbackInboxId?: string): MailThreadDetail {
  const summary = normalizeThread(raw, fallbackInboxId);
  const messages = (pick<any[]>(raw, "messages") ?? []).map((message) =>
    normalizeMessage(message, summary.inboxId ?? fallbackInboxId)
  );
  return {
    ...summary,
    messages
  };
}

export function normalizeDraft(raw: any, fallbackInboxId?: string): MailDraft {
  const draftId = String(pick(raw, "draftId", "draft_id", "id") ?? "");
  const inboxId = String(pick(raw, "inboxId", "inbox_id") ?? fallbackInboxId ?? "");
  return {
    draftId,
    inboxId,
    messageId: pick(raw, "messageId", "message_id") ?? null,
    threadId: pick(raw, "threadId", "thread_id") ?? null,
    to: toAddressList(pick(raw, "to")),
    subject: String(pick(raw, "subject") ?? "(no subject)"),
    text: String(pick(raw, "text") ?? ""),
    html: pick(raw, "html") ?? null,
    labels: normalizeLabels(pick(raw, "labels")),
    createdAt: new Date(String(pick(raw, "createdAt", "created_at") ?? new Date().toISOString())).toISOString(),
    sendAt: pick(raw, "sendAt", "send_at") ?? null
  };
}

export function normalizeLabels(value: any): string[] {
  if (!value) return [];
  if (!Array.isArray(value)) return [String(value)];
  return [...new Set(value.map((item) => String(item)).filter(Boolean))];
}

function buildParticipants(messages: MailMessage[]): MailAddress[] {
  const byEmail = new Map<string, MailAddress>();
  for (const message of messages) {
    byEmail.set(message.from.email, message.from);
    for (const recipient of message.to) byEmail.set(recipient.email, recipient);
  }
  return [...byEmail.values()];
}
