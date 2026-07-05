import { PassThrough, Writable } from "node:stream";
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { CodexAppServerClient } from "../server/codex/codex-client";
import { MockMailGateway } from "../server/mail/mock-mail";
import { SseHub } from "../server/sse";
import type { CodexStreamEvent, MailThreadDetail } from "../shared/types";

class FakeStdin extends Writable {
  writes: any[] = [];
  constructor(private readonly stdout: PassThrough) {
    super();
  }
  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    const message = JSON.parse(chunk.toString());
    this.writes.push(message);
    if (message.id !== undefined) {
      const result =
        message.method === "thread/start"
          ? { thread: { id: "thr_fake" } }
          : message.method === "turn/start"
            ? { turn: { id: "turn_fake" } }
            : {};
      this.stdout.write(`${JSON.stringify({ id: message.id, result })}\n`);
    }
    callback();
  }
}

function fakeProcess() {
  const emitter = new EventEmitter() as any;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new FakeStdin(stdout);
  emitter.stdout = stdout;
  emitter.stderr = stderr;
  emitter.stdin = stdin;
  emitter.killed = false;
  emitter.kill = () => {
    emitter.killed = true;
    emitter.emit("exit", 0, null);
    return true;
  };
  return emitter;
}

class RecordingHub extends SseHub<CodexStreamEvent> {
  readonly events: CodexStreamEvent[] = [];

  publish(event: CodexStreamEvent) {
    this.events.push(event);
    super.publish(event);
  }
}

describe("CodexAppServerClient", () => {
  it("initializes app-server and starts a thread", async () => {
    const proc = fakeProcess();
    const client = new CodexAppServerClient({
      mail: new MockMailGateway(),
      hub: new SseHub<CodexStreamEvent>(),
      cwd: process.cwd(),
      processFactory: () => proc
    });

    const response = await client.startThread();
    expect(response.thread.id).toBe("thr_fake");
    expect(proc.stdin.writes.some((write: any) => write.method === "initialize")).toBe(true);
    expect(proc.stdin.writes.some((write: any) => write.method === "initialized")).toBe(true);
    expect(proc.stdin.writes.some((write: any) => write.method === "thread/start")).toBe(true);
    client.stop();
  });

  it("passes AgentMail MCP API key through an env-backed x-api-key header", async () => {
    const proc = fakeProcess();
    let processArgs: string[] = [];
    const client = new CodexAppServerClient({
      mail: new MockMailGateway(),
      hub: new SseHub<CodexStreamEvent>(),
      agentMailApiKey: "am_test",
      cwd: process.cwd(),
      processFactory: (args) => {
        processArgs = args;
        return proc;
      }
    });

    await client.startThread();

    expect(processArgs).toContain('mcp_servers.agentmail.env_http_headers={ "x-api-key" = "AGENTMAIL_API_KEY" }');
    expect(processArgs.join(" ")).not.toContain('."x-api-key"');
    client.stop();
  });

  it("starts turns with selected mail as text input only", async () => {
    const proc = fakeProcess();
    const client = new CodexAppServerClient({
      mail: new MockMailGateway(),
      hub: new SseHub<CodexStreamEvent>(),
      cwd: process.cwd(),
      processFactory: () => proc
    });
    const thread: MailThreadDetail = {
      threadId: "thread_1",
      inboxId: "inbox_1",
      subject: "Important launch details",
      preview: "Please confirm the launch date.",
      participants: [{ email: "sender@example.com", name: "Sender" }],
      lastMessageAt: "2026-07-04T10:00:00.000Z",
      labels: ["needs-reply"],
      messageCount: 1,
      unread: true,
      messages: [
        {
          messageId: "message_1",
          threadId: "thread_1",
          inboxId: "inbox_1",
          from: { email: "sender@example.com", name: "Sender" },
          to: [{ email: "me@example.com", name: "Me" }],
          cc: [],
          bcc: [],
          subject: "Important launch details",
          text: "Please confirm the launch date.",
          date: "2026-07-04T10:00:00.000Z",
          labels: ["needs-reply"],
          attachments: [],
          direction: "inbound"
        }
      ]
    };

    await client.startTurn({
      threadId: "thr_fake",
      prompt: "",
      preset: "summarize",
      mailThread: thread
    });

    const turnStart = proc.stdin.writes.find((write: any) => write.method === "turn/start");
    expect(turnStart.params).not.toHaveProperty("additionalContext");
    expect(turnStart.params.input).toHaveLength(1);
    expect(turnStart.params.input[0]).not.toHaveProperty("text_elements");
    expect(turnStart.params.input[0]).toMatchObject({ type: "text" });
    expect(turnStart.params.input[0].text).toContain("UNTRUSTED EMAIL THREAD CONTEXT");
    expect(turnStart.params.input[0].text).toContain("Important launch details");
    client.stop();
  });

  it("builds a Russian translation preset prompt", async () => {
    const proc = fakeProcess();
    const client = new CodexAppServerClient({
      mail: new MockMailGateway(),
      hub: new SseHub<CodexStreamEvent>(),
      cwd: process.cwd(),
      processFactory: () => proc
    });

    await client.startTurn({
      threadId: "thr_fake",
      prompt: "",
      preset: "translate_ru",
      mailThread: null
    });

    const turnStart = proc.stdin.writes.find((write: any) => write.method === "turn/start");
    expect(turnStart.params.responsesapiClientMetadata.preset).toBe("translate_ru");
    expect(turnStart.params.input[0].text).toContain("Translate the selected email thread into natural Russian");
    expect(turnStart.params.input[0].text).toContain("Do not create drafts");
    client.stop();
  });

  it("filters noisy Codex skill icon warnings from the event stream", async () => {
    const proc = fakeProcess();
    const hub = new RecordingHub();
    const client = new CodexAppServerClient({
      mail: new MockMailGateway(),
      hub,
      cwd: process.cwd(),
      processFactory: () => proc
    });

    await client.startThread();
    proc.stderr.write(
      "2026-07-04T18:09:43.448003Z WARN codex_core_skills::loader: ignoring interface.icon_large: icon path with '..' must resolve under plugin assets/\n"
    );
    proc.stderr.write(
      "2026-07-04T18:21:14.042701Z WARN codex_core_plugins::manifest: ignoring interface.defaultPrompt[0]: prompt must be at most 128 characters\n"
    );
    proc.stderr.write("ERROR codex app-server failed\n");

    expect(
      hub.events.some((event) => event.type === "status" && event.message?.includes("interface.icon_large"))
    ).toBe(false);
    expect(
      hub.events.some((event) => event.type === "status" && event.message?.includes("interface.defaultPrompt"))
    ).toBe(false);
    expect(hub.events.some((event) => event.type === "status" && event.message === "ERROR codex app-server failed")).toBe(
      true
    );
    client.stop();
  });
});
