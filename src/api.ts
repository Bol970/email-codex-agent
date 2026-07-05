import type {
  ApprovalRequest,
  CodexStreamEvent,
  InboxListResponse,
  MailDraft,
  MailEvent,
  MailThreadDetail,
  PresetAction,
  StatusResponse,
  ThreadListResponse
} from "@shared/types";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `${response.status} ${response.statusText}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const client = {
  status: () => api<StatusResponse>("/api/status"),
  inboxes: () => api<InboxListResponse>("/api/inboxes"),
  threads: (params: { inboxId?: string; query?: string; labels?: string[] }) => {
    const search = new URLSearchParams();
    if (params.inboxId) search.set("inboxId", params.inboxId);
    if (params.query) search.set("query", params.query);
    if (params.labels?.length) search.set("labels", params.labels.join(","));
    return api<ThreadListResponse>(`/api/threads?${search.toString()}`);
  },
  thread: (threadId: string, inboxId?: string) => {
    const search = new URLSearchParams();
    if (inboxId) search.set("inboxId", inboxId);
    return api<MailThreadDetail>(`/api/threads/${encodeURIComponent(threadId)}?${search.toString()}`);
  },
  reply: (messageId: string, body: { inboxId: string; text: string; html?: string | null; replyAll?: boolean }) =>
    api(`/api/messages/${encodeURIComponent(messageId)}/reply`, {
      method: "POST",
      body: JSON.stringify(body)
    }),
  draftReply: (messageId: string, body: { inboxId: string; text: string; html?: string | null; labels?: string[] }) =>
    api<MailDraft>(`/api/messages/${encodeURIComponent(messageId)}/draft-reply`, {
      method: "POST",
      body: JSON.stringify(body)
    }),
  drafts: (inboxId: string) => api<{ drafts: MailDraft[] }>(`/api/drafts?inboxId=${encodeURIComponent(inboxId)}`),
  sendDraft: (draftId: string, inboxId: string) =>
    api(`/api/drafts/${encodeURIComponent(draftId)}/send`, {
      method: "POST",
      body: JSON.stringify({ inboxId })
    }),
  deleteDraft: (draftId: string, inboxId: string) =>
    api<void>(`/api/drafts/${encodeURIComponent(draftId)}`, {
      method: "DELETE",
      body: JSON.stringify({ inboxId })
    }),
  updateLabels: (
    messageId: string,
    body: { inboxId: string; addLabels?: string[]; removeLabels?: string[] }
  ) =>
    api(`/api/messages/${encodeURIComponent(messageId)}/labels`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
  codexAccount: () => api("/api/codex/account"),
  codexLoginChatgpt: () => api("/api/codex/login/chatgpt", { method: "POST", body: "{}" }),
  codexLoginDeviceCode: () => api("/api/codex/login/device-code", { method: "POST", body: "{}" }),
  codexThread: () => api<{ thread: { id: string } }>("/api/codex/thread", { method: "POST", body: "{}" }),
  codexTurn: (body: {
    threadId: string;
    prompt: string;
    preset?: PresetAction;
    mailThreadId?: string;
    inboxId?: string;
  }) =>
    api("/api/codex/turn", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  codexApproval: (request: ApprovalRequest, decision: string) =>
    api("/api/codex/approval", {
      method: "POST",
      body: JSON.stringify({ requestId: request.id, decision })
    })
};

export function connectEvents<T extends MailEvent | CodexStreamEvent>(
  path: string,
  onEvent: (event: T) => void
) {
  const source = new EventSource(path);
  source.onmessage = (event) => {
    try {
      onEvent(JSON.parse(event.data) as T);
    } catch {
      // Ignore malformed event frames from reconnect boundaries.
    }
  };
  return () => source.close();
}
