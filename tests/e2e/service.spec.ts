import { expect, test } from "@playwright/test";
import { commandCalls, installTauriMock } from "./tauri-mock";

test("stops and starts the discovered service through the task boundary", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "服务状态" }).click();

  await page.getByRole("button", { name: "停止服务" }).click();
  await expect(page.getByText("服务已停止。")).toBeVisible();
  expect(await commandCalls(page, "stop_amkr")).toHaveLength(1);

  await page.getByRole("button", { name: "启动服务" }).click();
  await expect(page.getByText("服务已启动。")).toBeVisible();
  expect(await commandCalls(page, "start_amkr")).toHaveLength(1);
});
