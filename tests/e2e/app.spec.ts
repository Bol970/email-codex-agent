import { expect, test } from "@playwright/test";

test("reads a thread and creates a draft", async ({ page }, testInfo) => {
  const draftText = `Confirmed. I will keep sending behind approval. ${testInfo.project.name}`;

  await page.goto("/");
  await expect(page.getByText("Email Codex")).toBeVisible();
  const launchThread = page.getByRole("button", { name: /Pilot inbox: launch checklist/ });
  await expect(launchThread).toBeVisible();

  await launchThread.click();
  await expect(page.getByRole("article").getByText("Can you confirm the local agent")).toBeVisible();

  await page.getByPlaceholder("Write a reply").fill(draftText);
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByText(draftText)).toBeVisible();
});

test("mobile layout keeps core panes reachable", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Email Codex")).toBeVisible();
  await expect(page.getByPlaceholder("Search mail")).toBeVisible();
  await expect(page.getByText("Codex", { exact: true })).toBeVisible();
});

test("opening an unread thread clears its dot", async ({ page }) => {
  await page.goto("/");
  const invoiceThread = page.getByRole("button", { name: /Invoice question for July/ });
  await expect(invoiceThread.locator(".unread-dot")).toHaveCount(1);

  await invoiceThread.click();

  await expect(invoiceThread.locator(".unread-dot")).toHaveCount(0);
});
