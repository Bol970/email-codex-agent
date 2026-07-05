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
const pilotThread = page.getByRole("button", { name: /Pilot inbox: launch checklist/ });
await pilotThread.waitFor();
await installDemoCursor(page);

await caption(
  page,
  "Email Codex Agent: локальный email workspace с AgentMail и встроенным Codex.",
  3500
);

await demoClick(page, pilotThread, { xRatio: 0.34 });
await page.getByRole("article").getByText("Can you confirm the local agent").waitFor();
await caption(
  page,
  "Открываем входящее письмо. Здесь можно читать thread и вручную готовить ответ.",
  3500
);

await demoClick(page, page.getByRole("button", { name: "Summarize", exact: true }));
await page.getByText("Краткое резюме по письму").waitFor({ timeout: 10000 });
await caption(
  page,
  "Codex получает выбранный thread как контекст и кратко выделяет смысл письма и следующий шаг.",
  4500
);

await demoClick(page, page.getByRole("button", { name: "Draft reply", exact: true }));
await page.getByText("Черновик создан в выбранном письме.").waitFor({ timeout: 10000 });
await page.getByText("Hi Maya,").waitFor({ timeout: 10000 });
await caption(
  page,
  "Draft-first policy: Codex подготовил черновик, но отправка остаётся только за пользователем.",
  4500
);

await demoClick(page, page.getByPlaceholder("Write a reply"), { yRatio: 0.28 });
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

async function demoClick(page, locator, options = {}) {
  await locator.waitFor({ state: "visible" });
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(120);

  const box = await locator.boundingBox();
  if (!box) throw new Error("Demo target is not visible");

  const xRatio = options.xRatio ?? 0.5;
  const yRatio = options.yRatio ?? 0.5;
  const target = {
    x: Math.round(box.x + box.width * xRatio + (options.offsetX ?? 0)),
    y: Math.round(box.y + box.height * yRatio + (options.offsetY ?? 0))
  };

  await moveDemoCursor(page, target.x, target.y, options.durationMs ?? 680);
  await cursorPress(page);
  await locator.click({ position: { x: Math.max(1, box.width * xRatio), y: Math.max(1, box.height * yRatio) } });
  await page.waitForTimeout(options.afterMs ?? 420);
}

async function installDemoCursor(page) {
  await page.evaluate(() => {
    if (!document.querySelector("[data-demo-cursor-style]")) {
      const style = document.createElement("style");
      style.setAttribute("data-demo-cursor-style", "true");
      style.textContent = `
        [data-demo-cursor] {
          position: fixed;
          left: 0;
          top: 0;
          width: 0;
          height: 0;
          z-index: 2147483646;
          pointer-events: none;
          transform: translate3d(96px, 120px, 0);
          will-change: transform;
        }

        [data-demo-cursor]::before {
          content: "";
          position: absolute;
          left: 0;
          top: 0;
          width: 28px;
          height: 34px;
          clip-path: polygon(0 0, 0 29px, 8px 22px, 14px 34px, 20px 31px, 14px 20px, 27px 20px);
          background: rgb(248, 251, 255);
          filter:
            drop-shadow(1px 1px 0 rgb(31, 43, 68))
            drop-shadow(-1px -1px 0 rgb(31, 43, 68))
            drop-shadow(0 4px 5px rgba(0, 0, 0, 0.38));
        }

        [data-demo-cursor]::after {
          content: "";
          position: absolute;
          left: 17px;
          top: 17px;
          width: 12px;
          height: 12px;
          border: 2px solid rgba(255, 190, 56, 0.95);
          border-radius: 999px;
          background: rgba(255, 190, 56, 0.28);
          opacity: 0;
          transform: translate(-50%, -50%) scale(0.38);
        }

        [data-demo-cursor].is-clicking::after {
          animation: demo-cursor-pulse 420ms ease-out;
        }

        @keyframes demo-cursor-pulse {
          0% {
            opacity: 0.95;
            transform: translate(-50%, -50%) scale(0.38);
          }
          100% {
            opacity: 0;
            transform: translate(-50%, -50%) scale(3);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          [data-demo-cursor].is-clicking::after {
            animation-duration: 1ms;
          }
        }
      `;
      document.head.appendChild(style);
    }

    if (!document.querySelector("[data-demo-cursor]")) {
      const cursor = document.createElement("div");
      cursor.setAttribute("data-demo-cursor", "true");
      cursor.setAttribute("aria-hidden", "true");
      cursor.dataset.x = "96";
      cursor.dataset.y = "120";
      document.body.appendChild(cursor);
    }
  });
}

async function moveDemoCursor(page, x, y, durationMs) {
  await page.evaluate(
    ({ x, y, durationMs }) =>
      new Promise((resolve) => {
        const cursor = document.querySelector("[data-demo-cursor]");
        if (!cursor) {
          resolve();
          return;
        }

        const startX = Number(cursor.dataset.x ?? x);
        const startY = Number(cursor.dataset.y ?? y);
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const duration = reducedMotion ? 1 : durationMs;
        const start = performance.now();
        const easeOutQuart = (value) => 1 - Math.pow(1 - value, 4);

        const render = (now) => {
          const progress = Math.min(1, (now - start) / duration);
          const eased = easeOutQuart(progress);
          const currentX = startX + (x - startX) * eased;
          const currentY = startY + (y - startY) * eased;
          cursor.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;

          if (progress < 1) {
            window.requestAnimationFrame(render);
            return;
          }

          cursor.dataset.x = String(x);
          cursor.dataset.y = String(y);
          resolve();
        };

        window.requestAnimationFrame(render);
      }),
    { x, y, durationMs }
  );
  await page.mouse.move(x, y).catch(() => undefined);
}

async function cursorPress(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const cursor = document.querySelector("[data-demo-cursor]");
        if (!cursor) {
          resolve();
          return;
        }

        cursor.classList.remove("is-clicking");
        void cursor.getBoundingClientRect();
        cursor.classList.add("is-clicking");
        window.setTimeout(() => {
          cursor.classList.remove("is-clicking");
          resolve();
        }, 420);
      })
  );
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
