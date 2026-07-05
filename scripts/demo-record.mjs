import { spawn } from "node:child_process";
import process from "node:process";
import { chromium } from "@playwright/test";

const port = Number.parseInt(process.env.DEMO_PORT ?? "5175", 10);
const baseUrl = `http://127.0.0.1:${port}`;
const headless = process.env.DEMO_HEADLESS === "1";
const exitOnFinish = process.env.DEMO_EXIT_ON_FINISH === "1";
const server = spawn(process.execPath, ["dist-server/server/index.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    NODE_ENV: "production",
    MOCK_MODE: "1",
    DEMO_MODE: "1",
    BLUR_EMAIL_ADDRESSES: "0",
    AGENTMAIL_API_KEY: "",
    AGENTMAIL_INBOX_ID: ""
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let browser;

server.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
server.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
process.on("exit", () => {
  if (!server.killed) server.kill("SIGTERM");
});

await waitForStatus();
browser = await chromium.launch({
  headless,
  args: headless ? [] : ["--start-maximized"]
});
const page = await browser.newPage({ viewport: headless ? { width: 1440, height: 920 } : null });
await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: /Pilot inbox: launch checklist/ }).waitFor();

await caption(
  page,
  "Email Codex Agent: локальный email workspace с AgentMail и встроенным Codex.",
  3500
);

await page.getByRole("button", { name: /Pilot inbox: launch checklist/ }).click();
await page.getByRole("article").getByText("Can you confirm the local agent").waitFor();
await caption(
  page,
  "Открываем входящее письмо. Здесь можно читать thread и вручную готовить ответ.",
  3500
);

await page.getByRole("button", { name: "Summarize", exact: true }).click();
await page.getByText("Краткое резюме по письму").waitFor({ timeout: 10000 });
await caption(
  page,
  "Codex получает выбранный thread как контекст и кратко выделяет смысл письма и следующий шаг.",
  4500
);

await page.getByRole("button", { name: "Draft reply", exact: true }).click();
await page.getByText("Черновик создан в выбранном письме.").waitFor({ timeout: 10000 });
await page.getByText("Hi Maya,").waitFor({ timeout: 10000 });
await caption(
  page,
  "Draft-first policy: Codex подготовил черновик, но отправка остаётся только за пользователем.",
  4500
);

await page.getByPlaceholder("Write a reply").click();
await caption(
  page,
  "Пользователь сохраняет контроль: можно написать ответ вручную, сохранить draft или вообще ничего не отправлять.",
  4500
);

await caption(
  page,
  "Итог: AgentMail отвечает за почту, Codex помогает с анализом и черновиками, а необратимые действия остаются под явным контролем.",
  6500
);

console.log("\nDemo autopilot finished. Keep recording if needed; press Ctrl+C here to close the demo browser and server.");
if (exitOnFinish) {
  await shutdown();
  process.exit(0);
}
await new Promise((resolve) => {
  process.once("SIGINT", resolve);
  process.once("SIGTERM", resolve);
});
await shutdown();

async function caption(page, text, durationMs) {
  await page.evaluate((value) => {
    let node = document.querySelector("[data-demo-caption]");
    if (!node) {
      node = document.createElement("div");
      node.setAttribute("data-demo-caption", "true");
      Object.assign(node.style, {
        position: "fixed",
        left: "50%",
        bottom: "28px",
        transform: "translateX(-50%)",
        zIndex: "2147483647",
        maxWidth: "min(920px, calc(100vw - 48px))",
        padding: "16px 20px",
        borderRadius: "10px",
        border: "1px solid rgba(255, 190, 56, 0.82)",
        background: "rgba(16, 22, 38, 0.94)",
        color: "rgb(255, 221, 132)",
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: "20px",
        lineHeight: "1.35",
        textAlign: "center",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.35)",
        pointerEvents: "none"
      });
      document.body.appendChild(node);
    }
    node.textContent = value;
  }, text);
  await page.waitForTimeout(durationMs);
}

async function waitForStatus() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/status`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Demo server did not become ready at ${baseUrl}`);
}

async function shutdown() {
  if (browser) await browser.close().catch(() => undefined);
  if (!server.killed) server.kill("SIGTERM");
}
