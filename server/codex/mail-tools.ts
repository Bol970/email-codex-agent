import { nanoid } from "nanoid";
import type { AgentActionLog } from "../../shared/types.js";
import type { MailGateway } from "../mail/types.js";

export function buildMailDynamicTools() {
  return [
    {
      type: "namespace",
      name: "mail",
      description:
        "Safe local AgentMail tools. No tool can send email. Drafts and labels are allowed; sending requires explicit user approval in the host UI.",
      tools: [
        {
          type: "function",
          name: "list_threads",
          description: "List or search inbox threads by query and labels.",
          inputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
              inboxId: { type: "string" },
              query: { type: "string" },
              labels: { type: "array", items: { type: "string" } },
              limit: { type: "number", minimum: 1, maximum: 50 }
            }
          }
        },
        {
          type: "function",
          name: "get_thread",
          description: "Get a full email thread with messages.",
          inputSchema: {
            type: "object",
            additionalProperties: false,
            required: ["threadId"],
            properties: {
              threadId: { type: "string" },
              inboxId: { type: "string" }
            }
          }
        },
        {
          type: "function",
          name: "create_reply_draft",
          description:
            "Create a reply draft for a message. This saves an unsent draft only; it never sends email.",
          inputSchema: {
            type: "object",
            additionalProperties: false,
            required: ["inboxId", "messageId", "text"],
            properties: {
              inboxId: { type: "string" },
              messageId: { type: "string" },
              text: { type: "string" },
              html: { type: "string" },
              labels: { type: "array", items: { type: "string" } }
            }
          }
        },
        {
          type: "function",
          name: "update_labels",
          description: "Add or remove labels on a message.",
          inputSchema: {
            type: "object",
            additionalProperties: false,
            required: ["inboxId", "messageId"],
            properties: {
              inboxId: { type: "string" },
              messageId: { type: "string" },
              addLabels: { type: "array", items: { type: "string" } },
              removeLabels: { type: "array", items: { type: "string" } }
            }
          }
        },
        {
          type: "function",
          name: "log_action",
          description: "Record an agent action for the local audit log.",
          inputSchema: {
            type: "object",
            additionalProperties: false,
            required: ["action", "status", "summary"],
            properties: {
              action: { type: "string" },
              status: { type: "string" },
              summary: { type: "string" },
              threadId: { type: "string" },
              messageId: { type: "string" },
              result: {}
            }
          }
        }
      ]
    }
  ];
}

export async function runMailDynamicTool(mail: MailGateway, tool: string, args: any) {
  switch (tool) {
    case "list_threads":
      return mail.listThreads({
        inboxId: args.inboxId,
        query: args.query,
        labels: args.labels,
        limit: args.limit
      });
    case "get_thread":
      return mail.getThread(args.threadId, args.inboxId);
    case "create_reply_draft":
      return mail.createDraftReply(args.messageId, {
        inboxId: args.inboxId,
        text: args.text,
        html: args.html,
        labels: ["drafted", ...(args.labels ?? [])]
      });
    case "update_labels":
      return mail.updateLabels(args.messageId, {
        inboxId: args.inboxId,
        addLabels: args.addLabels,
        removeLabels: args.removeLabels
      });
    case "log_action":
      return mail.logAction({
        id: nanoid(),
        at: new Date().toISOString(),
        action: args.action,
        status: args.status,
        summary: args.summary,
        threadId: args.threadId ?? null,
        messageId: args.messageId ?? null,
        result: args.result
      } satisfies AgentActionLog);
    default:
      throw new Error(`Unknown mail tool: ${tool}`);
  }
}
