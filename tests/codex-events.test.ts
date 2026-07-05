import type * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCodexEvent } from "../src/App";
import type { ApprovalRequest, CodexStreamEvent } from "../shared/types";

type Message = {
  id: string;
  kind: "info" | "error" | "agent" | "tool" | "user" | "approval";
  text: string;
  streamKey?: string;
  approval?: ApprovalRequest;
  decision?: string;
};

function dispatchState<T>(read: () => T, write: (value: T) => void): React.Dispatch<React.SetStateAction<T>> {
  return (value) => {
    write(typeof value === "function" ? (value as (current: T) => T)(read()) : value);
  };
}

describe("handleCodexEvent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("combines Codex agent message deltas into one stream message", () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValueOnce("message_1").mockReturnValueOnce("message_2");

    let messages: Message[] = [];
    let approvals: ApprovalRequest[] = [];
    let busy = true;
    const setMessages = dispatchState(() => messages, (value) => {
      messages = value;
    }) as React.Dispatch<React.SetStateAction<any[]>>;
    const setApprovals = dispatchState(() => approvals, (value) => {
      approvals = value;
    });
    const setBusy = dispatchState(() => busy, (value) => {
      busy = value;
    });

    const delta = (text: string): CodexStreamEvent => ({
      type: "rpc",
      method: "item/agentMessage/delta",
      params: { itemId: "item_1", delta: text }
    });

    handleCodexEvent(delta("При"), setMessages, setApprovals, setBusy);
    handleCodexEvent(delta("вет"), setMessages, setApprovals, setBusy);
    handleCodexEvent(
      {
        type: "rpc",
        method: "item/completed",
        params: { item: { id: "item_1", type: "agentMessage", text: "Привет" } }
      },
      setMessages,
      setApprovals,
      setBusy
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ kind: "agent", text: "Привет", streamKey: "item_1" });
  });

  it("appends assistant stream after the user's message", () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValueOnce("agent_1");

    let messages: Message[] = [{ id: "user_1", kind: "user", text: "Что в письме?" }];
    let approvals: ApprovalRequest[] = [];
    let busy = true;
    const setMessages = dispatchState(() => messages, (value) => {
      messages = value;
    }) as React.Dispatch<React.SetStateAction<any[]>>;
    const setApprovals = dispatchState(() => approvals, (value) => {
      approvals = value;
    });
    const setBusy = dispatchState(() => busy, (value) => {
      busy = value;
    });

    handleCodexEvent(
      {
        type: "rpc",
        method: "item/agentMessage/delta",
        params: { itemId: "item_1", delta: "Короткое резюме" }
      },
      setMessages,
      setApprovals,
      setBusy
    );

    expect(messages.map((message) => message.kind)).toEqual(["user", "agent"]);
    expect(messages[1]).toMatchObject({ text: "Короткое резюме", streamKey: "item_1" });
  });

  it("adds approval requests to the chat stream without duplicates", () => {
    let messages: Message[] = [];
    let approvals: ApprovalRequest[] = [];
    let busy = true;
    const setMessages = dispatchState(() => messages, (value) => {
      messages = value;
    }) as React.Dispatch<React.SetStateAction<any[]>>;
    const setApprovals = dispatchState(() => approvals, (value) => {
      approvals = value;
    });
    const setBusy = dispatchState(() => busy, (value) => {
      busy = value;
    });
    const request: ApprovalRequest = {
      id: "approval_1",
      method: "item/commandExecution/requestApproval",
      title: "Codex wants to run a command",
      reason: "Needs to inspect the local project",
      command: "npm run test",
      payload: {},
      availableDecisions: ["accept", "decline"]
    };
    const event: CodexStreamEvent = { type: "approval_request", request };

    handleCodexEvent(event, setMessages, setApprovals, setBusy);
    handleCodexEvent(event, setMessages, setApprovals, setBusy);

    expect(approvals).toHaveLength(1);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: "approval-approval_1",
      kind: "approval",
      text: "Codex wants to run a command",
      approval: request
    });
  });

  it("does not show generic successful tool events in the chat", () => {
    let messages: Message[] = [];
    let approvals: ApprovalRequest[] = [];
    let busy = true;
    const setMessages = dispatchState(() => messages, (value) => {
      messages = value;
    }) as React.Dispatch<React.SetStateAction<any[]>>;
    const setApprovals = dispatchState(() => approvals, (value) => {
      approvals = value;
    });
    const setBusy = dispatchState(() => busy, (value) => {
      busy = value;
    });

    handleCodexEvent(
      { type: "tool_result", requestId: "tool_1", tool: "log_action", ok: true, result: { ok: true } },
      setMessages,
      setApprovals,
      setBusy
    );

    expect(messages).toHaveLength(0);
  });

  it("shows draft tool events as a human-readable chat note", () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValueOnce("draft_message");

    let messages: Message[] = [];
    let approvals: ApprovalRequest[] = [];
    let busy = true;
    const setMessages = dispatchState(() => messages, (value) => {
      messages = value;
    }) as React.Dispatch<React.SetStateAction<any[]>>;
    const setApprovals = dispatchState(() => approvals, (value) => {
      approvals = value;
    });
    const setBusy = dispatchState(() => busy, (value) => {
      busy = value;
    });

    handleCodexEvent(
      { type: "tool_result", requestId: "tool_2", tool: "create_reply_draft", ok: true, result: { draftId: "draft_1" } },
      setMessages,
      setApprovals,
      setBusy
    );

    expect(messages).toEqual([
      {
        id: "draft_message",
        kind: "tool",
        text: "Черновик создан в выбранном письме."
      }
    ]);
  });
});
