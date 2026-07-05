import { describe, expect, it } from "vitest";
import { MockMailGateway } from "../server/mail/mock-mail";

describe("MockMailGateway integration flow", () => {
  it("lists threads and reads a full thread", async () => {
    const mail = new MockMailGateway();
    const threads = await mail.listThreads({ inboxId: mail.selectedInboxId });
    expect(threads.threads.length).toBeGreaterThan(0);

    const detail = await mail.getThread(threads.threads[0].threadId);
    expect(detail.messages.length).toBeGreaterThan(0);
    expect(detail.subject).toBe(threads.threads[0].subject);
  });

  it("creates a draft and sends it only through explicit sendDraft", async () => {
    const mail = new MockMailGateway();
    const threads = await mail.listThreads({ inboxId: mail.selectedInboxId });
    const detail = await mail.getThread(threads.threads[0].threadId);
    const last = detail.messages.at(-1)!;

    const draft = await mail.createDraftReply(last.messageId, {
      inboxId: mail.selectedInboxId!,
      text: "Thanks, I will check.",
      labels: ["drafted"]
    });
    expect(draft.draftId).toContain("draft_");

    const drafts = await mail.listDrafts(mail.selectedInboxId!);
    expect(drafts).toHaveLength(1);

    const sent = await mail.sendDraft(draft.draftId, mail.selectedInboxId!);
    expect(sent.direction).toBe("outbound");
    expect(await mail.listDrafts(mail.selectedInboxId!)).toHaveLength(0);
  });
});
