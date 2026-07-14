import { expect, test } from "@playwright/test";
import { commandCalls, installTauriMock } from "./tauri-mock";

test("discovers an existing AMKR instance and renders live metrics", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "概览" })).toBeVisible();
  await expect(page.getByLabel("数据总览").getByText("1,284", { exact: true })).toBeVisible();
  await expect(page.getByText("1.04M")).toBeVisible();
  await expect(page.getByText("服务运行中").first()).toBeVisible();
});

test("keeps navigation and tool controls inside a narrow viewport", async ({ page }) => {
  await installTauriMock(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "集成" }).click();

  const layout = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(layout.scrollWidth).toBe(layout.clientWidth);
  await expect(page.getByRole("combobox", { name: "路由模式" }).first()).toBeVisible();
});

test("creates, registers, and starts AMKR on a fresh install", async ({ page }) => {
  await installTauriMock(page, "fresh");
  await page.goto("/");

  await expect(page.getByText("私有运行时已就绪")).toBeVisible();
  await page.getByRole("button", { name: "创建默认配置并启动" }).click();

  await expect(page.getByText("服务运行中").first()).toBeVisible();
  await expect.poll(() => commandCalls(page, "initialize_default_amkr_config")).toEqual([{ command: "initialize_default_amkr_config", args: {} }]);
  await expect.poll(() => commandCalls(page, "install_user_amkr")).toEqual([{
    command: "install_user_amkr",
    args: { configPath: "C:/Users/test/AppData/Local/AutoModelKeyRouter/router-config.json" },
  }]);
  await expect.poll(() => commandCalls(page, "start_amkr")).toEqual([{
    command: "start_amkr",
    args: { configPath: "C:/Users/test/AppData/Local/AutoModelKeyRouter/router-config.json" },
  }]);
});
