import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";

const invokeMock = vi.mocked(invoke);
const metadata = {
  config_path: "C:/amkr/router-config.json",
  base_url: "http://127.0.0.1:18900",
  metrics_db_path: null,
  log_file_path: null,
  auth_enabled: true,
};

describe("SettingsPage", () => {
  afterEach(() => vi.restoreAllMocks());

  beforeEach(() => {
    invokeMock.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("imports pasted configuration without requiring a prior export", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_amkr_providers") return { config_revision: "revision-latest", providers: [] };
      if (command === "import_amkr_config") return { config_revision: "revision-next", imported: true };
      return undefined;
    });
    render(<SettingsPage configPath={null} metadata={metadata} onConfigPathChange={() => undefined} />);

    fireEvent.change(screen.getByLabelText("可迁移配置"), { target: { value: '{"providers":{},"models":{}}' } });
    fireEvent.click(screen.getByRole("button", { name: "导入配置" }));

    await waitFor(() => expect(invokeMock).toHaveBeenNthCalledWith(1, "get_amkr_providers", { configPath: null }));
    expect(invokeMock).toHaveBeenNthCalledWith(2, "import_amkr_config", {
      configPath: null,
      configRevision: "revision-latest",
      config: { providers: {}, models: {} },
    });
    expect(await screen.findByText("配置已导入，AMKR 已热重载。")).toBeInTheDocument();
  });

  it("rejects invalid JSON before calling the service", async () => {
    render(<SettingsPage configPath="C:/amkr.json" metadata={metadata} onConfigPathChange={() => undefined} />);

    fireEvent.change(screen.getByLabelText("可迁移配置"), { target: { value: "{" } });
    fireEvent.click(screen.getByRole("button", { name: "导入配置" }));

    expect(await screen.findByText("配置内容不是有效 JSON。")).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("locks the selected instance while an import is in progress", async () => {
    let releaseRevision: ((value: { config_revision: string; providers: never[] }) => void) | undefined;
    const revision = new Promise<{ config_revision: string; providers: never[] }>((resolve) => { releaseRevision = resolve; });
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_amkr_providers") return revision;
      if (command === "import_amkr_config") return { config_revision: "revision-next", imported: true };
      return undefined;
    });
    render(<SettingsPage configPath="C:/amkr.json" metadata={metadata} onConfigPathChange={() => undefined} />);
    fireEvent.change(screen.getByLabelText("可迁移配置"), { target: { value: '{"providers":{}}' } });
    fireEvent.click(screen.getByRole("button", { name: "导入配置" }));

    expect(await screen.findByRole("button", { name: "正在导入" })).toBeDisabled();
    expect(screen.getByLabelText("配置路径")).toBeDisabled();
    expect(screen.getByRole("button", { name: "使用配置" })).toBeDisabled();
    expect(screen.getByLabelText("可迁移配置")).toBeDisabled();
    expect(invokeMock).toHaveBeenCalledTimes(1);

    releaseRevision?.({ config_revision: "revision-latest", providers: [] });
    expect(await screen.findByText("配置已导入，AMKR 已热重载。")).toBeInTheDocument();
    expect(screen.getByLabelText("配置路径")).toBeEnabled();
  });
});
