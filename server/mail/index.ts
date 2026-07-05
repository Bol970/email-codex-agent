import type { AppConfig } from "../config.js";
import { AgentMailGateway, NeedsConfigMailGateway } from "./agentmail-service.js";
import { MockMailGateway } from "./mock-mail.js";
import type { MailGateway } from "./types.js";

export function createMailGateway(config: AppConfig): MailGateway {
  if (config.mockMode) return new MockMailGateway();
  if (config.agentMailApiKey) {
    return new AgentMailGateway(config.agentMailApiKey, config.agentMailInboxId);
  }
  return new NeedsConfigMailGateway();
}
