import { expect, test } from "@playwright/test";
import { commandCalls, installTauriMock } from "./tauri-mock";

test("loads provider and route configuration from the selected instance", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "供应商" }).click();
  await expect(page.getByRole("heading", { name: "provider-a" })).toBeVisible();

  await page.getByRole("button", { name: "模型路由" }).click();
  await expect(page.getByRole("heading", { name: "model-a", exact: true })).toBeVisible();
});

test("applies and rolls back a Codex native integration", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "集成" }).click();
  const codex = page.locator("article").filter({ has: page.getByRole("heading", { name: "Codex" }) });

  await codex.getByRole("combobox", { name: "路由模式" }).selectOption("native");
  await codex.getByRole("button", { name: "应用" }).click();
  await expect(codex.getByText("已接管 · native")).toBeVisible();
  expect(await commandCalls(page, "configure_agent_integration")).toHaveLength(1);

  await codex.getByRole("button", { name: "回退" }).click();
  await expect(codex.getByText("检测到配置")).toBeVisible();
  expect(await commandCalls(page, "rollback_agent_integration")).toHaveLength(1);
});
