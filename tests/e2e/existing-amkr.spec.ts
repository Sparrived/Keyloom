import { expect, test } from "@playwright/test";
import { installTauriMock } from "./tauri-mock";

test("shows the selected CLI config and packaged runtime metadata", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).click();

  await expect(page.getByLabel("配置路径")).toHaveValue("C:/Users/test/AppData/Local/AutoModelKeyRouter/router-config.json");
  await expect(page.getByText("已安装 · AMKR 3.1.1")).toBeVisible();
  await expect(page.getByText("3.12.10")).toBeVisible();
  await expect(page.getByText("aaaaaaaaaaaa…")).toBeVisible();
});
