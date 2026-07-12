import { expect, test } from "@playwright/test";
import { installTauriMock } from "./tauri-mock";

test.beforeEach(async ({ page }) => {
  await installTauriMock(page);
});

test("discovers an existing AMKR instance and renders live metrics", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "概览" })).toBeVisible();
  await expect(page.getByText("1,284", { exact: true })).toBeVisible();
  await expect(page.getByText("1.04M")).toBeVisible();
  await expect(page.getByText("服务运行中").first()).toBeVisible();
});

test("keeps navigation and tool controls inside a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "集成" }).click();

  const layout = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(layout.scrollWidth).toBe(layout.clientWidth);
  await expect(page.getByRole("combobox", { name: "路由模式" }).first()).toBeVisible();
});
