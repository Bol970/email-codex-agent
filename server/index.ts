import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createServer } from "node:http";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { CodexAppServerClient } from "./codex/codex-client.js";
import { createMailGateway } from "./mail/index.js";
import { installFetchProxy } from "./proxy.js";
import { SseHub } from "./sse.js";
import type { CodexStreamEvent, MailEvent } from "../shared/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = process.cwd();

async function main() {
  const config = loadConfig();
  await installFetchProxy(config.agentMailProxyUrl);
  const mailHub = new SseHub<MailEvent>();
  const codexHub = new SseHub<CodexStreamEvent>();
  const mail = createMailGateway(config);
  const codex = new CodexAppServerClient({
    mail,
    hub: codexHub,
    agentMailApiKey: config.agentMailApiKey,
    cwd: projectRoot
  });

  const app = createApp({ config, mail, codex, mailHub, codexHub });

  await mail.startRealtime((event) => mailHub.publish(event)).catch((error) => {
    console.warn(`AgentMail realtime disabled: ${error instanceof Error ? error.message : String(error)}`);
  });

  if (config.nodeEnv === "production") {
    const distPath = path.resolve(__dirname, "../../dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      root: projectRoot,
      appType: "custom",
      server: {
        middlewareMode: true,
        hmr: process.env.VITE_HMR === "0" ? false : undefined
      }
    });
    app.use(vite.middlewares);
    app.use("*", async (req, res, next) => {
      try {
        const url = req.originalUrl;
        const template = fs.readFileSync(path.resolve(projectRoot, "index.html"), "utf-8");
        const html = await vite.transformIndexHtml(url, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(html);
      } catch (error) {
        vite.ssrFixStacktrace(error as Error);
        next(error);
      }
    });
  }

  const server = createServer(app);
  server.listen(config.port, () => {
    const mode = mail.mode === "mock" ? "mock data" : mail.mode === "needs_config" ? "setup mode" : "AgentMail";
    console.log(`Email Codex Agent running at http://127.0.0.1:${config.port} (${mode})`);
    if (config.agentMailProxyUrl) console.log(`Outbound fetch proxy: ${config.agentMailProxyUrl}`);
  });

  const shutdown = async () => {
    codex.stop();
    await mail.stopRealtime();
    mailHub.close();
    codexHub.close();
    server.close(() => process.exit(0));
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
