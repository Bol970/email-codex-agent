import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

export type AppConfig = {
  port: number;
  agentMailApiKey?: string;
  agentMailInboxId?: string;
  agentMailProxyUrl?: string;
  mockMode: boolean;
  nodeEnv: string;
};

export function loadConfig(): AppConfig {
  return {
    port: Number.parseInt(process.env.PORT ?? "5173", 10),
    agentMailApiKey: emptyToUndefined(process.env.AGENTMAIL_API_KEY),
    agentMailInboxId: emptyToUndefined(process.env.AGENTMAIL_INBOX_ID),
    agentMailProxyUrl: emptyToUndefined(process.env.AGENTMAIL_PROXY_URL) ?? "http://127.0.0.1:8118",
    mockMode: process.env.MOCK_MODE === "1" || process.env.MOCK_MODE === "true",
    nodeEnv: process.env.NODE_ENV ?? "development"
  };
}

function emptyToUndefined(value: string | undefined): string | undefined {
  if (!value || value.trim() === "") return undefined;
  return value.trim();
}
