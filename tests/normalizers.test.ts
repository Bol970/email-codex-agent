import { describe, expect, it } from "vitest";
import { normalizeMessage, normalizeThreadDetail } from "../server/mail/normalizers";

describe("AgentMail normalizers", () => {
  it("normalizes snake_case message fields and extracted text", () => {
    const message = normalizeMessage(
      {
        message_id: "m1",
        thread_id: "t1",
        inbox_id: "agent@agentmail.to",
        from_: { email: "sender@example.com", name: "Sender" },
        to: ["agent@agentmail.to"],
        subject: "Hello",
        text: "full body",
        extracted_text: "new reply",
        labels: ["needs-reply", "needs-reply"],
        attachments: [{ attachment_id: "a1", filename: "brief.pdf" }]
      },
      "agent@agentmail.to"
    );

    expect(message.messageId).toBe("m1");
    expect(message.extractedText).toBe("new reply");
    expect(message.labels).toEqual(["needs-reply"]);
    expect(message.attachments[0].attachmentId).toBe("a1");
  });

  it("builds thread detail from nested messages", () => {
    const thread = normalizeThreadDetail({
      thread_id: "t2",
      subject: "Question",
      messages: [
        {
          message_id: "m2",
          thread_id: "t2",
          inbox_id: "agent@agentmail.to",
          from: "client@example.com",
          to: ["agent@agentmail.to"],
          text: "Can you help?",
          labels: ["waiting"]
        }
      ]
    });

    expect(thread.threadId).toBe("t2");
    expect(thread.messages).toHaveLength(1);
    expect(thread.preview).toContain("Can you help");
  });
});
