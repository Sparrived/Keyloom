import { expect, test } from "@playwright/test";
import { commandCalls, installTauriMock } from "./tauri-mock";

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
