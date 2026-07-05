import * as React from "react";
import {
  Archive,
  ArrowUp,
  Bot,
  Check,
  Clock3,
  FileText,
  Inbox,
  Languages,
  ListChecks,
  LogIn,
  Mail,
  PenLine,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Tags,
  Trash2,
  X
} from "lucide-react";
import { client, connectEvents } from "./api";
import type {
  ApprovalRequest,
  CodexStreamEvent,
  InboxSummary,
  MailDraft,
  MailEvent,
  MailMessage,
  MailThreadDetail,
  MailThreadSummary,
  PresetAction,
  StatusResponse
} from "@shared/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type UiMessage = {
  id: string;
  kind: "info" | "error" | "agent" | "tool" | "user" | "approval";
  text: string;
  streamKey?: string;
  approval?: ApprovalRequest;
  decision?: string;
};

const filters = [
  { label: "Inbox", value: "", icon: Inbox },
  { label: "Needs reply", value: "needs-reply", icon: Mail },
  { label: "Important", value: "important", icon: Archive },
  { label: "Waiting", value: "waiting", icon: Clock3 },
  { label: "Done", value: "done", icon: Check }
];

const presets: Array<{ action: PresetAction; label: string; icon: React.ElementType }> = [
  { action: "summarize", label: "Summarize", icon: Sparkles },
  { action: "draft_reply", label: "Draft reply", icon: PenLine },
  { action: "classify", label: "Classify", icon: Tags },
  { action: "extract_actions", label: "Actions", icon: ListChecks },
  { action: "related_threads", label: "Related", icon: Search },
  { action: "follow_up", label: "Follow up", icon: Clock3 },
  { action: "briefing", label: "Briefing", icon: Inbox },
  { action: "translate_ru", label: "Translate to Russian", icon: Languages }
];

const hiddenSystemLabels = new Set(["received", "sent", "unread", "read", "inbound", "outbound"]);
const emailAddressPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

type EmailTextPart = {
  text: string;
  isEmail: boolean;
};

function codexUserMessage(prompt: string, preset?: PresetAction) {
  const presetLabel = preset ? presets.find((item) => item.action === preset)?.label : null;
  if (presetLabel && prompt) return `${presetLabel}\n\n${prompt}`;
  return presetLabel ?? prompt;
}

function hasLabel(labels: string[], value: string) {
  return labels.some((label) => label.toLowerCase() === value);
}

function isVisibleLabel(label: string) {
  return !hiddenSystemLabels.has(label.toLowerCase());
}

export function splitEmailText(text: string): EmailTextPart[] {
  const parts: EmailTextPart[] = [];
  emailAddressPattern.lastIndex = 0;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = emailAddressPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, match.index), isEmail: false });
    }
    parts.push({ text: match[0], isEmail: true });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), isEmail: false });
  }

  return parts.length ? parts : [{ text, isEmail: false }];
}

function withoutLabel<T extends string>(labels: T[], value: string): T[] {
  return labels.filter((label) => label.toLowerCase() !== value);
}

function summaryWithoutUnread<T extends MailThreadSummary>(thread: T): T {
  return { ...thread, labels: withoutLabel(thread.labels, "unread"), unread: false };
}

function detailWithoutUnread(thread: MailThreadDetail): MailThreadDetail {
  return {
    ...summaryWithoutUnread(thread),
    messages: thread.messages.map((message) => ({
      ...message,
      labels: withoutLabel(message.labels, "unread")
    }))
  };
}

function detailHasUnread(thread: MailThreadDetail) {
  return hasLabel(thread.labels, "unread") || thread.messages.some((message) => hasLabel(message.labels, "unread"));
}

export function App() {
  const [status, setStatus] = React.useState<StatusResponse | null>(null);
  const [inboxes, setInboxes] = React.useState<InboxSummary[]>([]);
  const [selectedInboxId, setSelectedInboxId] = React.useState<string>("");
  const [threads, setThreads] = React.useState<MailThreadSummary[]>([]);
  const [selectedThread, setSelectedThread] = React.useState<MailThreadDetail | null>(null);
  const [drafts, setDrafts] = React.useState<MailDraft[]>([]);
  const [query, setQuery] = React.useState("");
  const [activeLabel, setActiveLabel] = React.useState("");
  const [replyText, setReplyText] = React.useState("");
  const [codexThreadId, setCodexThreadId] = React.useState<string | null>(null);
  const [codexInput, setCodexInput] = React.useState("");
  const [codexMessages, setCodexMessages] = React.useState<UiMessage[]>([]);
  const [approvals, setApprovals] = React.useState<ApprovalRequest[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isCodexBusy, setIsCodexBusy] = React.useState(false);
  const [readThreadIds, setReadThreadIds] = React.useState<Set<string>>(() => new Set());

  const selectedInbox = selectedInboxId || status?.selectedInboxId || inboxes[0]?.inboxId || "";
  const blurEmailAddresses = Boolean(status?.blurEmailAddresses);

  const markThreadReadOptimistically = React.useCallback((threadId: string) => {
    setReadThreadIds((current) => {
      if (current.has(threadId)) return current;
      const next = new Set(current);
      next.add(threadId);
      return next;
    });
    setThreads((items) => items.map((item) => (item.threadId === threadId ? summaryWithoutUnread(item) : item)));
    setSelectedThread((current) => (current?.threadId === threadId ? detailWithoutUnread(current) : current));
  }, []);

  const persistThreadRead = React.useCallback(async (thread: MailThreadDetail, fallbackInboxId: string) => {
    const unreadMessages = thread.messages.filter((message) => hasLabel(message.labels, "unread"));
    if (!unreadMessages.length) return;
    await Promise.all(
      unreadMessages.map((message) =>
        client.updateLabels(message.messageId, {
          inboxId: message.inboxId || fallbackInboxId,
          removeLabels: ["unread"]
        })
      )
    );
  }, []);

  const refreshThreads = React.useCallback(async () => {
    if (!selectedInbox) return;
    const response = await client.threads({
      inboxId: selectedInbox,
      query,
      labels: activeLabel ? [activeLabel] : undefined
    });
    setThreads(response.threads.map((thread) => (readThreadIds.has(thread.threadId) ? summaryWithoutUnread(thread) : thread)));
    if (!selectedThread && response.threads[0]) {
      const detail = await client.thread(response.threads[0].threadId, selectedInbox);
      setSelectedThread(detailWithoutUnread(detail));
      if (detailHasUnread(detail)) {
        markThreadReadOptimistically(detail.threadId);
        void persistThreadRead(detail, selectedInbox).catch((error) => console.warn("Failed to mark thread read", error));
      }
    }
  }, [activeLabel, markThreadReadOptimistically, persistThreadRead, query, readThreadIds, selectedInbox, selectedThread]);

  const refreshDrafts = React.useCallback(async () => {
    if (!selectedInbox) return;
    try {
      const response = await client.drafts(selectedInbox);
      setDrafts(response.drafts);
    } catch {
      setDrafts([]);
    }
  }, [selectedInbox]);

  React.useEffect(() => {
    let mounted = true;
    async function boot() {
      setIsLoading(true);
      try {
        const [statusResponse, inboxResponse] = await Promise.all([client.status(), client.inboxes()]);
        if (!mounted) return;
        setStatus(statusResponse);
        setInboxes(inboxResponse.inboxes);
        const nextInbox = statusResponse.selectedInboxId ?? inboxResponse.inboxes[0]?.inboxId ?? "";
        setSelectedInboxId(nextInbox);
      } catch (error) {
        pushMessage(setCodexMessages, "error", errorText(error));
      } finally {
        if (mounted) setIsLoading(false);
      }
    }
    void boot();
    return () => {
      mounted = false;
    };
  }, []);

  React.useEffect(() => {
    void refreshThreads().catch((error) => pushMessage(setCodexMessages, "error", errorText(error)));
  }, [refreshThreads]);

  React.useEffect(() => {
    void refreshDrafts();
  }, [refreshDrafts, selectedThread?.threadId]);

  React.useEffect(() => {
    const disconnectMail = connectEvents<MailEvent>("/api/events", (event) => {
      if (event.type.startsWith("mail.")) {
        if (event.type === "mail.message_received") {
          const threadId = event.message?.threadId ?? event.thread?.threadId;
          if (threadId) {
            setReadThreadIds((current) => {
              if (!current.has(threadId)) return current;
              const next = new Set(current);
              next.delete(threadId);
              return next;
            });
          }
        }
        void refreshThreads();
      }
    });
    const disconnectCodex = connectEvents<CodexStreamEvent>("/api/codex/events", (event) => {
      handleCodexEvent(event, setCodexMessages, setApprovals, setIsCodexBusy);
      if (event.type === "tool_result" && event.ok) {
        void refreshDrafts();
        void refreshThreads();
      }
    });
    return () => {
      disconnectMail();
      disconnectCodex();
    };
  }, [refreshDrafts, refreshThreads]);

  async function selectThread(thread: MailThreadSummary) {
    if (selectedThread?.threadId !== thread.threadId) setReplyText("");
    if (hasLabel(thread.labels, "unread")) markThreadReadOptimistically(thread.threadId);
    const inboxId = thread.inboxId ?? selectedInbox;
    const detail = await client.thread(thread.threadId, inboxId);
    setSelectedThread(detailWithoutUnread(detail));
    if (detailHasUnread(detail)) {
      markThreadReadOptimistically(detail.threadId);
      void persistThreadRead(detail, inboxId).catch((error) => console.warn("Failed to mark thread read", error));
    }
  }

  async function sendReply() {
    const last = selectedThread?.messages.at(-1);
    if (!last || !replyText.trim()) return;
    await client.reply(last.messageId, {
      inboxId: selectedInbox,
      text: replyText.trim()
    });
    setReplyText("");
    await selectThread(selectedThread);
    await refreshThreads();
  }

  async function createDraft() {
    const last = selectedThread?.messages.at(-1);
    if (!last || !replyText.trim()) return;
    const draft = await client.draftReply(last.messageId, {
      inboxId: selectedInbox,
      text: replyText.trim(),
      labels: ["drafted"]
    });
    setDrafts((items) => [draft, ...items.filter((item) => item.draftId !== draft.draftId)]);
    setReplyText("");
    pushMessage(setCodexMessages, "tool", `Draft created: ${draft.draftId}`);
  }

  async function sendDraft(draft: MailDraft) {
    await client.sendDraft(draft.draftId, draft.inboxId);
    setDrafts((items) => items.filter((item) => item.draftId !== draft.draftId));
    await refreshThreads();
  }

  async function deleteDraft(draft: MailDraft) {
    await client.deleteDraft(draft.draftId, draft.inboxId);
    setDrafts((items) => items.filter((item) => item.draftId !== draft.draftId));
  }

  async function ensureCodexThread() {
    if (codexThreadId) return codexThreadId;
    const response = await client.codexThread();
    const nextId = response.thread.id;
    setCodexThreadId(nextId);
    return nextId;
  }

  async function runCodex(preset?: PresetAction) {
    if (isCodexBusy) return;
    const prompt = codexInput.trim();
    if (!preset && !prompt) return;

    setIsCodexBusy(true);
    pushMessage(setCodexMessages, "user", codexUserMessage(prompt, preset));
    setCodexInput("");
    try {
      const threadId = await ensureCodexThread();
      await client.codexTurn({
        threadId,
        prompt,
        preset,
        mailThreadId: selectedThread?.threadId,
        inboxId: selectedThread?.inboxId ?? selectedInbox
      });
    } catch (error) {
      setIsCodexBusy(false);
      pushMessage(setCodexMessages, "error", errorText(error));
    }
  }

  async function resolveApproval(request: ApprovalRequest, decision: string) {
    try {
      await client.codexApproval(request, decision);
      setApprovals((items) => items.filter((item) => !sameApprovalId(item.id, request.id)));
      setCodexMessages((items) =>
        items.map((message) =>
          message.kind === "approval" && message.approval && sameApprovalId(message.approval.id, request.id)
            ? { ...message, decision }
            : message
        )
      );
    } catch (error) {
      pushMessage(setCodexMessages, "error", errorText(error));
    }
  }

  return (
    <TooltipProvider>
      <div className="mail-grid">
        <Sidebar
          status={status}
          inboxes={inboxes}
          selectedInboxId={selectedInbox}
          blurEmailAddresses={blurEmailAddresses}
          activeLabel={activeLabel}
          onInboxChange={setSelectedInboxId}
          onLabelChange={setActiveLabel}
          onRefresh={() => void refreshThreads()}
        />
        <ThreadList
          threads={threads}
          selectedThreadId={selectedThread?.threadId}
          query={query}
          isLoading={isLoading}
          blurEmailAddresses={blurEmailAddresses}
          onQueryChange={setQuery}
          onSelect={(thread) => void selectThread(thread)}
        />
        <ReadingPane
          thread={selectedThread}
          drafts={drafts}
          replyText={replyText}
          blurEmailAddresses={blurEmailAddresses}
          onReplyTextChange={setReplyText}
          onSendReply={() => void sendReply()}
          onCreateDraft={() => void createDraft()}
          onSendDraft={(draft) => void sendDraft(draft)}
          onDeleteDraft={(draft) => void deleteDraft(draft)}
        />
        <CodexPane
          status={status}
          selectedThread={selectedThread}
          codexInput={codexInput}
          messages={codexMessages}
          approvals={approvals}
          blurEmailAddresses={blurEmailAddresses}
          isBusy={isCodexBusy}
          onInputChange={setCodexInput}
          onRun={(preset) => void runCodex(preset)}
          onResolve={(request, decision) => void resolveApproval(request, decision)}
          onLoginChatgpt={() =>
            void client.codexLoginChatgpt().then((result) => pushMessage(setCodexMessages, "info", JSON.stringify(result)))
          }
          onLoginDevice={() =>
            void client
              .codexLoginDeviceCode()
              .then((result) => pushMessage(setCodexMessages, "info", JSON.stringify(result)))
          }
        />
      </div>
    </TooltipProvider>
  );
}

function Sidebar(props: {
  status: StatusResponse | null;
  inboxes: InboxSummary[];
  selectedInboxId: string;
  blurEmailAddresses: boolean;
  activeLabel: string;
  onInboxChange: (value: string) => void;
  onLabelChange: (value: string) => void;
  onRefresh: () => void;
}) {
  return (
    <aside className="pane console-sidebar flex min-h-[240px] flex-col p-3">
      <div className="flex h-10 items-center gap-2 px-1">
        <div className="console-mark flex size-7 items-center justify-center rounded-md">
          <Mail className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="console-title truncate text-sm font-semibold">Email Codex</div>
          <div className="truncate text-xs text-muted-foreground">{props.status?.mode ?? "loading"}</div>
        </div>
        <IconButton label="Refresh" onClick={props.onRefresh}>
          <RefreshCw />
        </IconButton>
      </div>

      <Separator className="my-3" />

      <div className="flex flex-col gap-1">
        {props.inboxes.map((inbox) => (
          <Button
            key={inbox.inboxId}
            variant={props.selectedInboxId === inbox.inboxId ? "secondary" : "ghost"}
            className="h-8 w-full justify-start px-2 text-xs"
            onClick={() => props.onInboxChange(inbox.inboxId)}
          >
            <Inbox data-icon="inline-start" />
            <span className="truncate">
              <EmailAwareText text={inbox.address} blurEmailAddresses={props.blurEmailAddresses} />
            </span>
          </Button>
        ))}
      </div>

      <div className="mt-5 flex flex-col gap-1">
        {filters.map((filter) => (
          <Button
            key={filter.value || "all"}
            variant={props.activeLabel === filter.value ? "secondary" : "ghost"}
            className="h-8 w-full justify-start px-2 text-xs"
            onClick={() => props.onLabelChange(filter.value)}
          >
            <filter.icon data-icon="inline-start" />
            {filter.label}
          </Button>
        ))}
      </div>

      {props.status?.mode === "needs_config" && (
        <div className="mt-auto rounded-md border border-warning-border bg-warning p-3 text-xs text-warning-foreground">
          Set `AGENTMAIL_API_KEY` in `.env.local`.
        </div>
      )}
    </aside>
  );
}

function ThreadList(props: {
  threads: MailThreadSummary[];
  selectedThreadId?: string;
  query: string;
  isLoading: boolean;
  blurEmailAddresses: boolean;
  onQueryChange: (value: string) => void;
  onSelect: (thread: MailThreadSummary) => void;
}) {
  return (
    <section className="pane flex min-h-[320px] min-w-0 flex-col overflow-hidden">
      <div className="chrome-bar min-w-0 border-b border-border p-3">
        <div className="relative min-w-0">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            value={props.query}
            onChange={(event) => props.onQueryChange(event.target.value)}
            placeholder="Search mail"
            className="pl-8"
          />
        </div>
      </div>
      <ScrollArea className="min-h-0 min-w-0 flex-1">
        <div className="min-w-0 p-2">
          {props.isLoading && <div className="p-3 text-sm text-muted-foreground">Loading...</div>}
          {!props.isLoading && props.threads.length === 0 && (
            <div className="p-3 text-sm text-muted-foreground">No threads</div>
          )}
          {props.threads.map((thread) => {
            const isUnread = hasLabel(thread.labels, "unread");
            return (
              <button
                key={thread.threadId}
                className={cn(
                  "thread-card mb-2 block w-full min-w-0 overflow-hidden rounded-md border border-border/40 p-3 text-left transition-colors",
                  props.selectedThreadId === thread.threadId && "thread-card--active"
                )}
                onClick={() => props.onSelect(thread)}
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      {isUnread && <span className="unread-dot shrink-0" aria-hidden="true" />}
                      <span className="sr-only">{isUnread ? "Unread" : "Read"}</span>
                      <div className={cn("truncate text-sm", isUnread ? "font-semibold" : "font-medium")}>
                        {thread.subject}
                      </div>
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      <EmailAwareText
                        text={thread.participants.map((p) => p.name ?? p.email).join(", ")}
                        blurEmailAddresses={props.blurEmailAddresses}
                      />
                    </div>
                  </div>
                  <time className="shrink-0 text-[11px] text-muted-foreground">{shortTime(thread.lastMessageAt)}</time>
                </div>
                <p className="mt-2 line-clamp-2 max-w-full overflow-hidden break-words text-xs leading-5 text-muted-foreground">
                  <EmailAwareText text={thread.preview} blurEmailAddresses={props.blurEmailAddresses} />
                </p>
                <LabelRow labels={thread.labels} className="mt-2" />
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </section>
  );
}

function ReadingPane(props: {
  thread: MailThreadDetail | null;
  drafts: MailDraft[];
  replyText: string;
  blurEmailAddresses: boolean;
  onReplyTextChange: (value: string) => void;
  onSendReply: () => void;
  onCreateDraft: () => void;
  onSendDraft: (draft: MailDraft) => void;
  onDeleteDraft: (draft: MailDraft) => void;
}) {
  const relatedDrafts = props.thread
    ? props.drafts.filter((draft) => draft.threadId === props.thread?.threadId)
    : [];
  return (
    <main className="pane flex min-h-[460px] flex-col overflow-hidden bg-background">
      {!props.thread ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Select a thread</div>
      ) : (
        <>
          <div className="chrome-bar shrink-0 border-b border-border p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="console-title truncate text-lg font-semibold">{props.thread.subject}</h1>
                <div className="mt-1 text-xs text-muted-foreground">
                  {props.thread.messageCount} messages · {shortTime(props.thread.lastMessageAt)}
                </div>
              </div>
              <LabelRow labels={props.thread.labels} />
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1 overflow-hidden">
            <div className="flex flex-col gap-4 p-4">
              {props.thread.messages.map((message) => (
                <MessageBubble
                  key={message.messageId}
                  message={message}
                  blurEmailAddresses={props.blurEmailAddresses}
                />
              ))}
              {relatedDrafts.map((draft) => (
                <div key={draft.draftId} className="draft-card rounded-md border border-info-border bg-info p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-sm font-medium text-info-foreground">Draft</div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => props.onSendDraft(draft)}>
                        <Send data-icon="inline-start" />
                        Send
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => props.onDeleteDraft(draft)} aria-label="Delete draft">
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-6 text-info-foreground">
                    <EmailAwareText text={draft.text} blurEmailAddresses={props.blurEmailAddresses} />
                  </p>
                </div>
              ))}
            </div>
          </ScrollArea>

          <div className="chrome-dock shrink-0 border-t border-border p-3" data-testid="reply-dock">
            <Textarea
              value={props.replyText}
              onChange={(event) => props.onReplyTextChange(event.target.value)}
              placeholder="Write a reply"
              className="min-h-[112px] resize-none"
            />
            <div className="mt-2 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={props.onCreateDraft}
                disabled={!props.replyText.trim()}
                aria-label="Create draft"
              >
                <FileText />
                Draft
              </Button>
              <Button onClick={props.onSendReply} disabled={!props.replyText.trim()}>
                <Send />
                Send
              </Button>
            </div>
          </div>
        </>
      )}
    </main>
  );
}

function CodexPane(props: {
  status: StatusResponse | null;
  selectedThread: MailThreadDetail | null;
  codexInput: string;
  messages: UiMessage[];
  approvals: ApprovalRequest[];
  blurEmailAddresses: boolean;
  isBusy: boolean;
  onInputChange: (value: string) => void;
  onRun: (preset?: PresetAction) => void;
  onResolve: (request: ApprovalRequest, decision: string) => void;
  onLoginChatgpt: () => void;
  onLoginDevice: () => void;
}) {
  const chatEndRef = React.useRef<HTMLDivElement | null>(null);
  const lastMessageText = props.messages.at(-1)?.text;
  const lastMessageDecision = props.messages.at(-1)?.decision;
  const pendingApprovalIds = React.useMemo(
    () => new Set(props.approvals.map((request) => String(request.id))),
    [props.approvals]
  );

  React.useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "end" });
  }, [lastMessageDecision, lastMessageText, props.approvals.length, props.messages.length, props.isBusy]);

  const handleComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.altKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!props.isBusy && props.codexInput.trim()) props.onRun();
  };

  return (
    <aside className="agent-pane flex min-h-[460px] flex-col bg-card">
      <div className="chrome-bar shrink-0 border-b border-border p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="console-mark flex size-7 items-center justify-center rounded-md">
              <Bot className="size-4" />
            </div>
            <div className="min-w-0">
              <div className="console-title text-sm font-semibold">Codex</div>
              <div className="truncate text-xs text-muted-foreground">
                {props.status?.codexVersion ?? "app-server"}
              </div>
            </div>
          </div>
          <div className="flex gap-1">
            <IconButton label="ChatGPT login" onClick={props.onLoginChatgpt}>
              <LogIn />
            </IconButton>
            <IconButton label="Device login" onClick={props.onLoginDevice}>
              <Bot />
            </IconButton>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-8 gap-1">
          {presets.map((preset) => (
            <Tooltip key={preset.action}>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => props.onRun(preset.action)}
                  disabled={props.isBusy || (preset.action !== "briefing" && !props.selectedThread)}
                  aria-label={preset.label}
                >
                  <preset.icon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{preset.label}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex min-h-full flex-col gap-4 p-4">
          {props.messages.length === 0 && (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Ask Codex</div>
          )}
          {props.messages.map((message) => (
            <CodexMessageBubble
              key={message.id}
              message={message}
              pendingApproval={message.approval ? pendingApprovalIds.has(String(message.approval.id)) : false}
              blurEmailAddresses={props.blurEmailAddresses}
              onResolve={props.onResolve}
            />
          ))}
          {props.isBusy && props.messages.at(-1)?.kind === "user" && (
            <div className="max-w-[88%] text-sm leading-6 text-muted-foreground">Thinking...</div>
          )}
          <div ref={chatEndRef} />
        </div>
      </ScrollArea>

      <div className="chrome-dock shrink-0 border-t border-border p-3" data-testid="codex-dock">
        <div className="flex items-end gap-2">
          <Textarea
            value={props.codexInput}
            onChange={(event) => props.onInputChange(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder="Ask Codex"
            className="min-h-[52px] max-h-36 resize-none py-3"
            rows={1}
          />
          <Button
            size="icon"
            onClick={() => props.onRun()}
            disabled={props.isBusy || !props.codexInput.trim()}
            aria-label="Send to Codex"
          >
            <ArrowUp />
          </Button>
        </div>
      </div>
    </aside>
  );
}

function CodexMessageBubble({
  message,
  pendingApproval,
  blurEmailAddresses,
  onResolve
}: {
  message: UiMessage;
  pendingApproval: boolean;
  blurEmailAddresses: boolean;
  onResolve: (request: ApprovalRequest, decision: string) => void;
}) {
  if (message.kind === "approval" && message.approval) {
    return <ApprovalMessageBubble message={message} pending={pendingApproval} onResolve={onResolve} />;
  }

  const isUser = message.kind === "user";
  const isAssistant = message.kind === "agent";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[88%] rounded-md px-3 py-2 text-sm leading-6",
          isUser && "border border-warning-border bg-accent text-accent-foreground",
          isAssistant && "agent-message",
          message.kind === "info" && "border bg-background text-muted-foreground",
          message.kind === "error" && "border border-destructive/30 bg-destructive/5 text-destructive",
          message.kind === "tool" && "border border-success-border bg-success text-success-foreground"
        )}
      >
        <CodexMessageContent text={message.text} rich={isAssistant} blurEmailAddresses={blurEmailAddresses} />
      </div>
    </div>
  );
}

function ApprovalMessageBubble({
  message,
  pending,
  onResolve
}: {
  message: UiMessage;
  pending: boolean;
  onResolve: (request: ApprovalRequest, decision: string) => void;
}) {
  const request = message.approval;
  if (!request) return null;
  const acceptDecision = approvalDecision(request, ["accept", "submit"]);
  const declineDecision = approvalDecision(request, ["decline", "cancel"]);
  const resolvedLabel = approvalDecisionLabel(message.decision);

  return (
    <div className="flex justify-start">
      <div className="approval-card agent-message max-w-[92%] rounded-md border px-3 py-3 text-sm leading-6">
        <div className="console-title text-xs font-semibold">Codex просит подтверждение</div>
        <div className="mt-2 font-semibold">{request.title}</div>
        {request.reason && <p className="mt-1 text-xs text-muted-foreground">{request.reason}</p>}
        {request.command && (
          <code className="mt-2 block max-h-32 overflow-auto rounded-md border bg-muted p-2 text-xs whitespace-pre-wrap break-words">
            {request.command}
          </code>
        )}
        <div className="mt-3 flex items-center justify-end gap-2">
          {resolvedLabel || !pending ? (
            <Badge variant={message.decision === "accept" || message.decision === "submit" ? "done" : "secondary"}>
              {resolvedLabel ?? "Запрос закрыт"}
            </Badge>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={() => onResolve(request, declineDecision)}>
                <X data-icon="inline-start" />
                Отклонить
              </Button>
              <Button size="sm" onClick={() => onResolve(request, acceptDecision)}>
                <Check data-icon="inline-start" />
                Подтвердить
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CodexMessageContent({
  text,
  rich,
  blurEmailAddresses
}: {
  text: string;
  rich: boolean;
  blurEmailAddresses: boolean;
}) {
  if (!rich) {
    return (
      <pre className="whitespace-pre-wrap font-sans">
        <EmailAwareText text={text} blurEmailAddresses={blurEmailAddresses} />
      </pre>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {text.split(/\n{2,}/).map((block, index) => (
        <MarkdownBlock key={`${index}-${block.slice(0, 12)}`} text={block} blurEmailAddresses={blurEmailAddresses} />
      ))}
    </div>
  );
}

function MarkdownBlock({ text, blurEmailAddresses }: { text: string; blurEmailAddresses: boolean }) {
  const lines = text.split("\n").filter((line) => line.trim());
  const isList = lines.length > 1 && lines.every((line) => /^\s*[-*]\s+/.test(line));
  if (isList) {
    return (
      <ul className="flex list-disc flex-col gap-1 pl-5">
        {lines.map((line, index) => (
          <li key={`${index}-${line}`} className="pl-1">
            <InlineMarkdown text={line.replace(/^\s*[-*]\s+/, "")} blurEmailAddresses={blurEmailAddresses} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <p className="whitespace-pre-wrap">
      <InlineMarkdown text={text} blurEmailAddresses={blurEmailAddresses} />
    </p>
  );
}

function InlineMarkdown({ text, blurEmailAddresses }: { text: string; blurEmailAddresses: boolean }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={`${index}-${part}`} className="font-semibold">
            <EmailAwareText text={part.slice(2, -2)} blurEmailAddresses={blurEmailAddresses} />
          </strong>
        ) : (
          <React.Fragment key={`${index}-${part}`}>
            <EmailAwareText text={part} blurEmailAddresses={blurEmailAddresses} />
          </React.Fragment>
        )
      )}
    </>
  );
}

function EmailAwareText({ text, blurEmailAddresses }: { text: string; blurEmailAddresses: boolean }) {
  if (!blurEmailAddresses) return <>{text}</>;
  return (
    <>
      {splitEmailText(text).map((part, index) =>
        part.isEmail ? (
          <span
            key={`${index}-${part.text}`}
            className="privacy-blur"
            data-private="email"
            aria-label="email address hidden"
          >
            {part.text}
          </span>
        ) : (
          <React.Fragment key={`${index}-${part.text}`}>{part.text}</React.Fragment>
        )
      )}
    </>
  );
}

function MessageBubble({ message, blurEmailAddresses }: { message: MailMessage; blurEmailAddresses: boolean }) {
  const body = message.extractedText || message.text || "(empty)";
  return (
    <article className="message-card rounded-md border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">
            <EmailAwareText text={message.from.name ?? message.from.email} blurEmailAddresses={blurEmailAddresses} />
            <span className="ml-2 text-xs font-normal text-muted-foreground">{message.direction}</span>
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            to{" "}
            <EmailAwareText
              text={message.to.map((item) => item.name ?? item.email).join(", ")}
              blurEmailAddresses={blurEmailAddresses}
            />
          </div>
        </div>
        <time className="shrink-0 text-xs text-muted-foreground">{shortTime(message.date)}</time>
      </div>
      <p className="mt-4 whitespace-pre-wrap text-sm leading-6">
        <EmailAwareText text={body} blurEmailAddresses={blurEmailAddresses} />
      </p>
      <LabelRow labels={message.labels} className="mt-3" />
    </article>
  );
}

function LabelRow({ labels, className }: { labels: string[]; className?: string }) {
  const visibleLabels = labels.filter(isVisibleLabel);
  if (!visibleLabels.length) return null;
  return (
    <div className={cn("flex max-w-full flex-wrap gap-1 overflow-hidden", className)}>
      {visibleLabels.slice(0, 5).map((label) => (
        <Badge key={label} variant={badgeVariant(label)} className="label-badge max-w-full truncate">
          {label}
        </Badge>
      ))}
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick?: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon" variant="ghost" onClick={onClick} aria-label={label}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function handleCodexEvent(
  event: CodexStreamEvent,
  setMessages: React.Dispatch<React.SetStateAction<UiMessage[]>>,
  setApprovals: React.Dispatch<React.SetStateAction<ApprovalRequest[]>>,
  setBusy: React.Dispatch<React.SetStateAction<boolean>>
) {
  if (event.type === "approval_request") {
    setMessages((items) => {
      if (
        items.some((message) => message.kind === "approval" && message.approval && sameApprovalId(message.approval.id, event.request.id))
      ) {
        return items;
      }
      return [
        ...items,
        {
          id: `approval-${String(event.request.id)}`,
          kind: "approval",
          text: event.request.title,
          approval: event.request
        }
      ].slice(-120);
    });
    setApprovals((items) => {
      if (items.some((item) => sameApprovalId(item.id, event.request.id))) return items;
      return [event.request, ...items];
    });
    return;
  }
  if (event.type === "status") {
    if (event.status === "ready" || event.status === "closed" || event.status === "error") setBusy(false);
    if (event.message) pushMessage(setMessages, event.status === "error" ? "error" : "info", event.message);
    return;
  }
  if (event.type === "tool_result") {
    if (!event.ok) {
      pushMessage(setMessages, "error", event.error ?? "Tool failed");
      return;
    }
    if (event.tool === "create_reply_draft") {
      pushMessage(setMessages, "tool", "Черновик создан в выбранном письме.");
    }
    return;
  }
  if (event.type === "rpc") {
    handleRpcEvent(event.method, event.params, setMessages);
    if (event.method === "turn/completed") setBusy(false);
  }
}

function handleRpcEvent(
  method: string,
  params: unknown,
  setMessages: React.Dispatch<React.SetStateAction<UiMessage[]>>
) {
  const value = params as any;
  if (method === "item/agentMessage/delta") {
    appendMessageDelta(setMessages, rpcStreamKey(value), value?.delta ?? value?.text ?? "");
    return;
  }
  if (method === "item/completed" && value?.item?.type === "agentMessage") {
    completeStreamMessage(setMessages, rpcStreamKey(value), agentMessageText(value.item));
    return;
  }
  if (method === "turn/plan/updated") {
    pushMessage(setMessages, "info", value?.explanation ?? "Plan updated");
  }
}

function pushMessage(
  setMessages: React.Dispatch<React.SetStateAction<UiMessage[]>>,
  kind: UiMessage["kind"],
  text: string
) {
  if (!text.trim()) return;
  setMessages((items) => [...items, { id: crypto.randomUUID(), kind, text }].slice(-120));
}

function sameApprovalId(left: string | number, right: string | number) {
  return String(left) === String(right);
}

function approvalDecision(request: ApprovalRequest, preferred: string[]) {
  return preferred.find((decision) => request.availableDecisions.includes(decision)) ?? preferred[0];
}

function approvalDecisionLabel(decision?: string) {
  if (!decision) return null;
  if (decision === "accept") return "Подтверждено";
  if (decision === "submit") return "Отправлено";
  if (decision === "decline") return "Отклонено";
  if (decision === "cancel") return "Отменено";
  return `Решено: ${decision}`;
}

function appendMessageDelta(
  setMessages: React.Dispatch<React.SetStateAction<UiMessage[]>>,
  streamKey: string,
  delta: string
) {
  if (!delta) return;
  setMessages((items) => {
    const index = items.findIndex((item) => item.streamKey === streamKey);
    if (index === -1) return [...items, { id: crypto.randomUUID(), kind: "agent", text: delta, streamKey }].slice(-120);

    const next = [...items];
    next[index] = { ...next[index], text: `${next[index].text}${delta}` };
    return next;
  });
}

function completeStreamMessage(
  setMessages: React.Dispatch<React.SetStateAction<UiMessage[]>>,
  streamKey: string,
  text: string
) {
  if (!text.trim()) return;
  setMessages((items) => {
    const index = items.findIndex((item) => item.streamKey === streamKey);
    if (index === -1) {
      if (items.some((item) => item.kind === "agent" && item.text.trim() === text.trim())) return items;
      return [...items, { id: crypto.randomUUID(), kind: "agent", text, streamKey }].slice(-120);
    }

    const next = [...items];
    next[index] = { ...next[index], text };
    return next;
  });
}

function rpcStreamKey(value: any) {
  return String(
    value?.itemId ??
      value?.item_id ??
      value?.messageId ??
      value?.message_id ??
      value?.id ??
      value?.item?.id ??
      value?.item?.itemId ??
      value?.turnId ??
      value?.turn_id ??
      "agent-current"
  );
}

function agentMessageText(item: any) {
  if (typeof item?.text === "string") return item.text;
  if (Array.isArray(item?.content)) {
    return item.content
      .map((part: any) => part?.text ?? part?.content ?? "")
      .filter(Boolean)
      .join("");
  }
  return "";
}

function badgeVariant(label: string) {
  if (label === "important" || label === "needs-reply") return "important";
  if (label === "waiting" || label === "drafted") return "waiting";
  if (label === "done") return "done";
  return "secondary";
}

function shortTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString();
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
