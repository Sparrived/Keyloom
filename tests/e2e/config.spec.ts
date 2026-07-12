import { expect, test } from "@playwright/test";
import { commandCalls, installTauriMock } from "./tauri-mock";

test("loads provider and route configuration from the selected instance", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "供应商" }).click();
  await expect(page.getByRole("heading", { name: "provider-a" })).toBeVisible();
  expect((await commandCalls(page, "get_amkr_providers"))[0].args).toEqual({ configPath: null });

  await page.getByRole("button", { name: "模型路由" }).click();
  await expect(page.getByRole("heading", { name: "model-a", exact: true })).toBeVisible();
  expect((await commandCalls(page, "get_amkr_routes"))[0].args).toEqual({ configPath: null });
});

test("edits a provider with the current config revision", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "供应商" }).click();
  await page.getByRole("button", { name: "编辑供应商 provider-a" }).click();
  await page.getByLabel("供应商名称").fill("provider-b");
  await page.getByLabel("供应商地址").fill("https://b.example.test");
  await page.getByRole("button", { name: "保存供应商" }).click();

  await expect(page.getByRole("heading", { name: "provider-b" })).toBeVisible();
  expect(await commandCalls(page, "update_amkr_provider")).toEqual([{
    command: "update_amkr_provider",
    args: {
      configPath: null,
      configRevision: "revision-a",
      providerId: "provider-a",
      id: "provider-b",
      baseUrl: "https://b.example.test",
    },
  }]);
});

test("switches the unified model to a fixed key", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "模型路由" }).click();
  await page.getByRole("radio", { name: "固定 Key" }).click();
  await page.getByRole("button", { name: "保存统一模型" }).click();
  await page.getByRole("button", { name: "概览" }).click();

  await expect(page.getByText("固定 Key · main · 1 个目标")).toBeVisible();
  expect(await commandCalls(page, "update_amkr_unified_model")).toEqual([{
    command: "update_amkr_unified_model",
    args: { configPath: null, model: "model-a", key: "main", fallback: null, image: null },
  }]);
});

test("applies and rolls back a Codex native integration", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "集成" }).click();
  const codex = page.locator("article").filter({ has: page.getByRole("heading", { name: "Codex" }) });

  await codex.getByRole("combobox", { name: "路由模式" }).selectOption("native");
  await codex.getByRole("button", { name: "应用" }).click();
  await expect(codex.getByText("已接管 · native")).toBeVisible();
  expect(await commandCalls(page, "configure_agent_integration")).toEqual([{
    command: "configure_agent_integration",
    args: { configPath: null, agent: "codex", mode: "native" },
  }]);

  await codex.getByRole("button", { name: "回退" }).click();
  await expect(codex.getByText("检测到配置")).toBeVisible();
  expect(await commandCalls(page, "rollback_agent_integration")).toEqual([{
    command: "rollback_agent_integration",
    args: { agent: "codex" },
  }]);
});
