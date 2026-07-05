import { execFileSync, spawn } from "node:child_process";
import process from "node:process";
import { chromium } from "@playwright/test";

const port = Number.parseInt(process.env.DEMO_PORT ?? "5175", 10);
const baseUrl = `http://127.0.0.1:${port}`;
const headless = process.env.DEMO_HEADLESS === "1";
const keepOpen = process.env.DEMO_KEEP_OPEN === "1" && process.env.DEMO_EXIT_ON_FINISH !== "1";
const pace = Number.parseFloat(process.env.DEMO_PACE ?? "0.6");
const soundEnabled = process.env.DEMO_SOUND !== "0" && !headless;
const windowPlacement = headless ? null : resolveWindowPlacement();
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
  args: headless ? [] : browserLaunchArgs(windowPlacement)
});
const page = await browser.newPage({ viewport: headless ? { width: 1440, height: 920 } : null });
await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
const pilotThread = page.getByRole("button", { name: /Pilot inbox: launch checklist/ });
await pilotThread.waitFor();
await installDemoCursor(page);
await installDemoAudio(page, soundEnabled);

await caption(
  page,
  "Email Codex Agent: локальный email workspace с AgentMail и встроенным Codex.",
  14000,
  { sound: "start" }
);

await demoMoveTo(page, page.getByPlaceholder("Search mail"), { afterMs: 800 });
await caption(
  page,
  "Интерфейс устроен как рабочий почтовый клиент: слева inbox и фильтры, в центре список писем, справа агент Codex.",
  16000
);

await demoMoveTo(page, pilotThread, { xRatio: 0.34, afterMs: 800 });
await caption(
  page,
  "В demo-режиме здесь безопасные mock-письма. Это удобно для записи: реальные ключи, адреса и входящие не попадают в кадр.",
  16000
);

await demoClick(page, pilotThread, { xRatio: 0.34 });
await page.getByRole("article").getByText("Can you confirm the local agent").waitFor();
await caption(
  page,
  "Открываем входящее письмо. Основной сценарий остаётся привычным: прочитать thread, понять запрос и решить, что делать дальше.",
  18000
);

await demoMoveTo(page, page.getByRole("button", { name: "Summarize", exact: true }), { afterMs: 800 });
await caption(
  page,
  "Справа встроена панель Codex. Быстрые действия запускаются с выбранным письмом как контекстом, поэтому не нужно копировать текст вручную.",
  18000
);

await demoClick(page, page.getByRole("button", { name: "Summarize", exact: true }));
await page.getByText("Краткое резюме по письму").waitFor({ timeout: 10000 });
await playDemoSound(page, "success");
await caption(
  page,
  "Codex кратко выделяет смысл письма: кто написал, что просит отправитель, где риск и какой следующий шаг лучше выбрать.",
  26000
);

await demoMoveTo(page, page.getByRole("button", { name: "Draft reply", exact: true }), { afterMs: 800 });
await caption(
  page,
  "Следующий шаг — подготовить ответ. В первой версии агент работает по безопасной политике draft-first.",
  16000
);

await demoClick(page, page.getByRole("button", { name: "Draft reply", exact: true }));
await page.getByText("Черновик создан в выбранном письме.").waitFor({ timeout: 10000 });
await page.getByText("Hi Maya,").waitFor({ timeout: 10000 });
await playDemoSound(page, "success");
await caption(
  page,
  "Черновик появился прямо в письме. Codex помог сформулировать ответ, но не получил права отправить его самостоятельно.",
  26000
);

await demoMoveTo(page, page.getByRole("button", { name: "Send", exact: true }).first(), { afterMs: 800 });
await caption(
  page,
  "Кнопка Send остаётся видимой, но необратимое действие делает только пользователь. Это ключевой guardrail сервиса.",
  20000
);

await demoClick(page, page.getByPlaceholder("Write a reply"), { yRatio: 0.28 });
await caption(
  page,
  "Пользователь сохраняет полный контроль: можно отредактировать черновик, написать ответ вручную, сохранить draft или вообще ничего не отправлять.",
  22000
);

await caption(
  page,
  "Итог: AgentMail отвечает за почту, Codex помогает с анализом и черновиками, а необратимые действия остаются под явным контролем.",
  24000
);

await caption(
  page,
  "Презентация завершена. Сейчас demo browser закроется автоматически.",
  7000,
  { sound: "finish" }
);

console.log("\nDemo autopilot finished. Closing the demo browser and server.");
if (keepOpen) {
  console.log("DEMO_KEEP_OPEN=1 is set; press Ctrl+C to close the demo browser and server.");
  await new Promise((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
}
await shutdown();
process.exit(0);

function browserLaunchArgs(placement) {
  const audioArgs = ["--autoplay-policy=no-user-gesture-required"];
  if (!placement) return [...audioArgs, "--start-maximized"];
  console.log(
    `Demo browser window: ${placement.width}x${placement.height}+${placement.x}+${placement.y}` +
      (placement.label ? ` (${placement.label})` : "")
  );
  return [...audioArgs, `--window-position=${placement.x},${placement.y}`, `--window-size=${placement.width},${placement.height}`];
}

function resolveWindowPlacement() {
  const customPlacement = customWindowPlacement();
  if (customPlacement) return customPlacement;

  const monitors = readXrandrMonitors();
  if (monitors.length === 0) return null;

  const requested = process.env.DEMO_MONITOR ?? "2";
  if (requested) {
    const monitor = findRequestedMonitor(monitors, requested);
    if (monitor) return monitorToPlacement(monitor);
    if (process.env.DEMO_MONITOR) {
      console.warn(`Demo monitor "${requested}" was not found; using automatic monitor selection.`);
    }
  }

  const fallback = monitors.length > 1 ? monitors[1] : monitors[0];
  return monitorToPlacement(fallback);
}

function customWindowPlacement() {
  const x = optionalInt(process.env.DEMO_WINDOW_X);
  const y = optionalInt(process.env.DEMO_WINDOW_Y);
  if (x === undefined || y === undefined) return null;

  return {
    x,
    y,
    width: optionalInt(process.env.DEMO_WINDOW_WIDTH) ?? 1440,
    height: optionalInt(process.env.DEMO_WINDOW_HEIGHT) ?? 920,
    label: "custom"
  };
}

function readXrandrMonitors() {
  try {
    const output = execFileSync("xrandr", ["--listmonitors"], { encoding: "utf8", timeout: 2500 });
    return output
      .split("\n")
      .map((line) => line.match(/^\s*(\d+):\s+([+*]*)(\S+)\s+(\d+)\/\d+x(\d+)\/\d+\+(-?\d+)\+(-?\d+)\s+(.+)$/))
      .filter(Boolean)
      .map((match) => ({
        index: Number(match[1]),
        primary: match[2].includes("*"),
        name: match[3],
        width: Number(match[4]),
        height: Number(match[5]),
        x: Number(match[6]),
        y: Number(match[7]),
        output: match[8].trim()
      }));
  } catch {
    return [];
  }
}

function findRequestedMonitor(monitors, requested) {
  const normalized = requested.trim().toLowerCase();
  if (normalized === "primary") return monitors.find((monitor) => monitor.primary);

  const requestedIndex = Number.parseInt(normalized, 10);
  if (String(requestedIndex) === normalized) {
    return monitors.find((monitor) => monitor.index === requestedIndex);
  }

  return monitors.find((monitor) => {
    const name = monitor.name.toLowerCase();
    const output = monitor.output.toLowerCase();
    return name === normalized || output === normalized;
  });
}

function monitorToPlacement(monitor) {
  return {
    x: monitor.x,
    y: monitor.y,
    width: optionalInt(process.env.DEMO_WINDOW_WIDTH) ?? monitor.width,
    height: optionalInt(process.env.DEMO_WINDOW_HEIGHT) ?? monitor.height,
    label: `${monitor.index}: ${monitor.output}${monitor.primary ? " primary" : ""}`
  };
}

function optionalInt(value) {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function scaledDuration(durationMs) {
  const multiplier = Number.isFinite(pace) && pace > 0 ? pace : 1;
  return Math.max(1, Math.round(durationMs * multiplier));
}

async function installDemoAudio(page, enabled) {
  await page.evaluate((enabled) => {
    const AudioContextCtor = window.AudioContext ?? window.webkitAudioContext;
    let context = null;

    const getContext = () => {
      if (!enabled || !AudioContextCtor) return null;
      context ??= new AudioContextCtor();
      void context.resume?.();
      return context;
    };

    const envelope = (audioContext, start, duration, peak) => {
      const gain = audioContext.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      gain.connect(audioContext.destination);
      return gain;
    };

    const tone = (audioContext, frequency, start, duration, peak = 0.025, type = "sine") => {
      const oscillator = audioContext.createOscillator();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start);
      oscillator.connect(envelope(audioContext, start, duration, peak));
      oscillator.start(start);
      oscillator.stop(start + duration + 0.03);
    };

    const sweep = (audioContext, from, to, start, duration, peak = 0.018) => {
      const oscillator = audioContext.createOscillator();
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(from, start);
      oscillator.frequency.exponentialRampToValueAtTime(to, start + duration);
      oscillator.connect(envelope(audioContext, start, duration, peak));
      oscillator.start(start);
      oscillator.stop(start + duration + 0.03);
    };

    const tick = (audioContext, start) => {
      const duration = 0.035;
      const buffer = audioContext.createBuffer(1, Math.floor(audioContext.sampleRate * duration), audioContext.sampleRate);
      const data = buffer.getChannelData(0);
      for (let index = 0; index < data.length; index += 1) {
        data[index] = (Math.random() * 2 - 1) * (1 - index / data.length);
      }
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(envelope(audioContext, start, duration, 0.035));
      source.start(start);
    };

    const play = (kind) => {
      const audioContext = getContext();
      if (!audioContext) return;

      const now = audioContext.currentTime + 0.01;
      if (kind === "start") {
        tone(audioContext, 440, now, 0.11, 0.02, "triangle");
        tone(audioContext, 660, now + 0.09, 0.11, 0.02, "triangle");
        tone(audioContext, 880, now + 0.18, 0.16, 0.022, "triangle");
        return;
      }

      if (kind === "move") {
        sweep(audioContext, 320, 520, now, 0.13, 0.014);
        return;
      }

      if (kind === "click") {
        tick(audioContext, now);
        tone(audioContext, 980, now + 0.006, 0.045, 0.018, "square");
        return;
      }

      if (kind === "success") {
        tone(audioContext, 587.33, now, 0.1, 0.021, "sine");
        tone(audioContext, 783.99, now + 0.08, 0.12, 0.021, "sine");
        tone(audioContext, 1174.66, now + 0.18, 0.17, 0.018, "sine");
        return;
      }

      if (kind === "finish") {
        tone(audioContext, 880, now, 0.13, 0.021, "triangle");
        tone(audioContext, 659.25, now + 0.11, 0.13, 0.02, "triangle");
        tone(audioContext, 440, now + 0.22, 0.22, 0.018, "triangle");
        return;
      }

      tone(audioContext, 698.46, now, 0.055, 0.012, "sine");
    };

    window.__emailCodexDemoAudio = { play };
  }, enabled);
}

async function playDemoSound(page, kind) {
  await page.evaluate((value) => window.__emailCodexDemoAudio?.play(value), kind).catch(() => undefined);
}

async function caption(page, text, durationMs, options = {}) {
  await playDemoSound(page, options.sound ?? "caption");
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
  await page.waitForTimeout(scaledDuration(durationMs));
}

async function demoMoveTo(page, locator, options = {}) {
  await locator.waitFor({ state: "visible" });
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(scaledDuration(120));

  const box = await locator.boundingBox();
  if (!box) throw new Error("Demo target is not visible");

  const xRatio = options.xRatio ?? 0.5;
  const yRatio = options.yRatio ?? 0.5;
  const target = {
    x: Math.round(box.x + box.width * xRatio + (options.offsetX ?? 0)),
    y: Math.round(box.y + box.height * yRatio + (options.offsetY ?? 0))
  };

  await playDemoSound(page, "move");
  await moveDemoCursor(page, target.x, target.y, scaledDuration(options.durationMs ?? 520));
  await page.waitForTimeout(scaledDuration(options.afterMs ?? 420));
}

async function demoClick(page, locator, options = {}) {
  await locator.waitFor({ state: "visible" });
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(scaledDuration(120));

  const box = await locator.boundingBox();
  if (!box) throw new Error("Demo target is not visible");

  const xRatio = options.xRatio ?? 0.5;
  const yRatio = options.yRatio ?? 0.5;
  const target = {
    x: Math.round(box.x + box.width * xRatio + (options.offsetX ?? 0)),
    y: Math.round(box.y + box.height * yRatio + (options.offsetY ?? 0))
  };

  await playDemoSound(page, "move");
  await moveDemoCursor(page, target.x, target.y, scaledDuration(options.durationMs ?? 520));
  await cursorPress(page);
  await playDemoSound(page, "click");
  await locator.click({ position: { x: Math.max(1, box.width * xRatio), y: Math.max(1, box.height * yRatio) } });
  await page.waitForTimeout(scaledDuration(options.afterMs ?? 420));
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
          background: rgb(8, 12, 22);
          filter:
            drop-shadow(1px 1px 0 rgb(255, 255, 255))
            drop-shadow(-1px -1px 0 rgb(255, 255, 255))
            drop-shadow(0 4px 5px rgba(0, 0, 0, 0.42));
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
