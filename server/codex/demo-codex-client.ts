import { nanoid } from "nanoid";
import type { CodexStreamEvent, MailThreadDetail, PresetAction } from "../../shared/types.js";
import type { MailGateway } from "../mail/types.js";
import type { SseHub } from "../sse.js";

export type CodexGateway = {
  accountRead(refreshToken?: boolean): Promise<unknown>;
  loginChatgpt(): Promise<unknown>;
  loginDeviceCode(): Promise<unknown>;
  startThread(): Promise<{ thread: { id: string } }>;
  startTurn(input: {
    threadId: string;
    prompt: string;
    preset?: PresetAction;
    mailThread?: MailThreadDetail | null;
  }): Promise<unknown>;
  resolveApproval(requestId: number | string, body: unknown): Promise<unknown>;
  stop(): void;
};

export class DemoCodexClient implements CodexGateway {
  constructor(
    private readonly options: {
      mail: MailGateway;
      hub: SseHub<CodexStreamEvent>;
    }
  ) {}

  async accountRead() {
    return { account: { type: "demo", status: "ready" } };
  }

  async loginChatgpt() {
    return { ok: true, mode: "demo" };
  }

  async loginDeviceCode() {
    return { ok: true, mode: "demo" };
  }

  async startThread() {
    return { thread: { id: `demo_thread_${nanoid(8)}` } };
  }

  async startTurn(input: {
    threadId: string;
    prompt: string;
    preset?: PresetAction;
    mailThread?: MailThreadDetail | null;
  }) {
    setTimeout(() => void this.runTurn(input), 450);
    return { ok: true, mode: "demo" };
  }

  async resolveApproval(requestId: number | string, _body: unknown) {
    return { ok: true, requestId };
  }

  stop() {
    // Demo mode has no subprocess.
  }

  private async runTurn(input: {
    threadId: string;
    prompt: string;
    preset?: PresetAction;
    mailThread?: MailThreadDetail | null;
  }) {
    try {
      if (input.preset === "draft_reply" && input.mailThread) {
        await this.createDraft({ threadId: input.threadId, mailThread: input.mailThread });
        return;
      }

      this.publishAgentMessage(input.threadId, demoText(input.preset, input.mailThread));
    } catch (error) {
      this.options.hub.publish({
        type: "status",
        status: "error",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async createDraft(input: { threadId: string; mailThread: MailThreadDetail }) {
    const last = input.mailThread.messages.at(-1);
    if (!last) throw new Error("Demo thread has no messages");
    const draft = await this.options.mail.createDraftReply(last.messageId, {
      inboxId: last.inboxId,
      text:
        "Hi Maya,\n\nConfirmed. The local email agent can summarize incoming threads, prepare reply drafts, and keep sending behind explicit user approval.\n\nBest,\nEmail Codex Agent",
      labels: ["drafted"]
    });
    this.options.hub.publish({
      type: "tool_result",
      requestId: `demo_tool_${nanoid(6)}`,
      tool: "create_reply_draft",
      ok: true,
      result: draft
    });
    this.publishAgentMessage(
      input.threadId,
      "Черновик ответа подготовлен. Я сохранил его как draft, но отправку оставил под явным контролем пользователя."
    );
  }

  private publishAgentMessage(threadId: string, text: string) {
    const itemId = `demo_item_${nanoid(8)}`;
    this.options.hub.publish({
      type: "rpc",
      method: "item/agentMessage/delta",
      params: { itemId, delta: text }
    });
    this.options.hub.publish({
      type: "rpc",
      method: "item/completed",
      params: { item: { id: itemId, type: "agentMessage", text } }
    });
    this.options.hub.publish({
      type: "rpc",
      method: "turn/completed",
      params: { threadId }
    });
  }
}

function demoText(preset: PresetAction | undefined, thread: MailThreadDetail | null | undefined) {
  const subject = thread?.subject ?? "selected thread";
  const labels = thread?.labels.length ? thread.labels.join(", ") : "без текущих пользовательских labels";

  switch (preset) {
    case "translate_ru":
      return [
        `Перевод письма "${subject}":`,
        "",
        "Отправитель просит подтвердить, что локальный email-агент умеет кратко пересказывать входящие письма, готовить черновики ответов и оставлять отправку только после явного подтверждения пользователя."
      ].join("\n");
    case "extract_actions":
      return [
        `Действия и дедлайны по письму "${subject}":`,
        "",
        "- Подтвердить, что агент умеет суммировать входящие thread.",
        "- Подготовить короткий draft reply без автоматической отправки.",
        "- Проверить, что отправка остаётся за пользователем через явный клик Send.",
        "- Дедлайн не указан; можно ответить сразу."
      ].join("\n");
    case "classify":
      return [
        `Классификация письма "${subject}":`,
        "",
        `- Текущие labels: ${labels}.`,
        "- Рекомендованные labels: needs-reply, important.",
        "- Причина: письмо просит подтверждение ключевой функциональности и ожидает ответа.",
        "- Автоматически отправлять labels в demo я не буду; это предложение для пользователя."
      ].join("\n");
    case "related_threads":
      return [
        `Связанные письма для "${subject}":`,
        "",
        "- Feedback on the email workspace UI: полезно сверить UX ожидания перед демонстрацией.",
        "- Invoice question for July: пример waiting-thread, где агент может извлечь deadline.",
        "- Эти связи помогают быстро собрать контекст перед ответом."
      ].join("\n");
    case "follow_up":
      return [
        `Follow-up план для "${subject}":`,
        "",
        "- Если ответа ещё нет через 24 часа, напомнить коротким письмом.",
        "- Тон: спокойный и подтверждающий, без давления.",
        "- Безопасный вариант: подготовить follow-up draft и оставить Send пользователю."
      ].join("\n");
    case "briefing":
      return [
        "Inbox briefing:",
        "",
        "- Pilot inbox: launch checklist — high priority, needs reply.",
        "- Invoice question for July — waiting on PO number before Friday.",
        "- Feedback on the email workspace UI — done, полезный контекст для polish.",
        "- Рекомендация: сначала закрыть launch checklist, затем invoice."
      ].join("\n");
    case "summarize":
    case "draft_reply":
    default:
      return [
        `Краткое резюме по письму "${subject}":`,
        "",
        "- Отправитель просит подтвердить возможности локального email-агента.",
        "- Важный акцент: агент может готовить черновики, но не должен сам отправлять письма.",
        "- Следующий шаг: подготовить короткий подтверждающий ответ и оставить его в draft."
      ].join("\n");
  }
}
