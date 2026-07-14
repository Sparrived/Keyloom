import { expect, test } from "@playwright/test";
import { commandCalls, installTauriMock } from "./tauri-mock";

test("shows live rates separately from the rolling 60-minute totals", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "近十分钟用量" })).toBeVisible();
  await expect(page.getByRole("button", { name: "RPM" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("12 次/分")).toBeVisible();
  await expect(page.getByText("RPM、TPM 为过去 1 分钟的滚动速率；缓存率为最近 60 分钟汇总。")).toBeVisible();
  await page.getByLabel("历史数据点").locator("button").hover();
  await expect(page.getByLabel("所选用量快照")).toContainText("RPM / TPM12 / 48,000近 60 分钟请求1,284");
});

test("shows the selected CLI config and packaged runtime metadata", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).click();

  await expect(page.getByLabel("配置路径")).toHaveValue("C:/Users/test/AppData/Local/AutoModelKeyRouter/router-config.json");
  await expect(page.getByText("已安装 · AMKR 3.1.1")).toBeVisible();
  await expect(page.getByText("3.12.10")).toBeVisible();
  await expect(page.getByText("aaaaaaaaaaaa…")).toBeVisible();
  await expect(page.getByText("127.0.0.1:19001", { exact: true })).toBeVisible();
  await expect(page.getByText("已启用", { exact: true }).first()).toBeVisible();
  expect((await commandCalls(page, "discover_amkr"))[0].args).toEqual({ configPath: null });
});
