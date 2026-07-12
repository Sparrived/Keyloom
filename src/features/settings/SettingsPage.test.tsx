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

  it("shows discovered runtime timeout settings", async () => {
    render(<SettingsPage configPath={null} metadata={{
      ...metadata,
      host: "127.0.0.1",
      port: 18900,
      request_timeout: 42.5,
      stream_first_byte_timeout: 55,
      stream_idle_timeout: 91.5,
      max_retries: 4,
    }} onConfigPathChange={() => undefined} />);

    expect(screen.getByText("监听地址")).toBeInTheDocument();
    expect(screen.getByText("127.0.0.1:18900")).toBeInTheDocument();
    expect(screen.getByText("请求超时")).toBeInTheDocument();
    expect(screen.getByText("42.5 秒")).toBeInTheDocument();
    expect(screen.getByText("流式首字节超时")).toBeInTheDocument();
    expect(screen.getByText("55 秒")).toBeInTheDocument();
    expect(screen.getByText("流式空闲超时")).toBeInTheDocument();
    expect(screen.getByText("91.5 秒")).toBeInTheDocument();
    expect(screen.getByText("最大重试")).toBeInTheDocument();
    expect(screen.getByText("4 次")).toBeInTheDocument();
  });

  it("shows safe health capabilities and the local key fingerprint", () => {
    render(<SettingsPage configPath={null} metadata={metadata} health={{
      status: "ok",
      local_auth_enabled: true,
      models: ["model-a", "model-b"],
      local_api_key_fingerprint: "65bbff9a6cb9",
      visitor_feature_installed: true,
      visitor_access_enabled: true,
      visitor_key_count: 2,
      native_endpoint_summary: { supported: 2, fallback: 1, unknown: 1 },
    }} onConfigPathChange={() => undefined} />);

    expect(screen.getByText("本地 API Key 指纹")).toBeInTheDocument();
    expect(screen.getByText("65bbff9a6cb9")).toBeInTheDocument();
    expect(screen.getByText("已配置 2 个模型")).toBeInTheDocument();
    expect(screen.getByText("访客访问：已启用（2 个 Key）")).toBeInTheDocument();
    expect(screen.getByText("原生可用 2 · 兼容回退 1 · 未识别 1")).toBeInTheDocument();
  });

  it("distinguishes an empty native endpoint cache from an unavailable summary", () => {
    const { rerender } = render(<SettingsPage configPath={null} metadata={metadata} health={{
      status: "ok",
      local_auth_enabled: true,
      native_endpoint_summary: { supported: 0, fallback: 0, unknown: 0 },
    }} onConfigPathChange={() => undefined} />);

    expect(screen.getByText("尚无探测缓存")).toBeInTheDocument();

    rerender(<SettingsPage configPath={null} metadata={metadata} health={{
      status: "ok",
      local_auth_enabled: true,
    }} onConfigPathChange={() => undefined} />);
    expect(screen.getByText("服务未提供")).toBeInTheDocument();
  });
});
