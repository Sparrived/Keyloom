import { expect, test } from "@playwright/test";
import { commandCalls, installTauriMock } from "./tauri-mock";

test("discovers an existing AMKR instance and renders live metrics", async ({ page }) => {
  await installTauriMock(page);
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "概览" })).toBeVisible();
  await expect(page.getByLabel("数据总览").getByText("1,284", { exact: true })).toBeVisible();
  await expect(page.getByText("1.04M")).toBeVisible();
  await expect(page.getByText("服务运行中").first()).toBeVisible();

  const layout = await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>(".overview-content")!;
    const unified = document.querySelector<HTMLElement>(".unified-model-card")!.getBoundingClientRect();
    const metrics = document.querySelector<HTMLElement>(".metrics-overview-card")!.getBoundingClientRect();
    const trend = document.querySelector<HTMLElement>(".trend-panel")!.getBoundingClientRect();
    const activityElement = document.querySelector<HTMLElement>(".activity-panel")!;
    const activity = activityElement.getBoundingClientRect();
    const activityStyle = getComputedStyle(activityElement);
    return {
      fitsViewport: content.scrollHeight <= content.clientHeight,
      cardHeightDifference: Math.round(Math.abs(unified.height - metrics.height)),
      trendGap: Math.round(trend.top - Math.max(unified.bottom, metrics.bottom)),
      bottomClearance: Math.round(content.getBoundingClientRect().bottom - activity.bottom),
      activityFrameless: activityStyle.borderTopWidth === "0px" && activityStyle.paddingTop === "0px",
    };
  });
  expect(layout.fitsViewport).toBe(true);
  expect(layout.activityFrameless).toBe(true);
  expect(layout.bottomClearance).toBeGreaterThanOrEqual(16);
  expect(layout.cardHeightDifference).toBeLessThanOrEqual(1);
  expect(layout.trendGap).toBeGreaterThanOrEqual(10);
  expect(layout.trendGap).toBeLessThanOrEqual(14);
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

  await expect(page.getByText("AMKR 3.1.1 已就绪")).toBeVisible();
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
