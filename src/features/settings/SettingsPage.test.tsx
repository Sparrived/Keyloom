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
const settingsResponse = {
  config_revision: "revision-settings",
  settings: {
    host: "127.0.0.1",
    port: 18900,
    request_timeout: 60,
    stream_first_byte_timeout: 90,
    stream_idle_timeout: 180,
    max_retries: 2,
    local_auth_enabled: true,
    local_api_key_fingerprint: "65bbff9a6cb9",
  },
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

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("get_amkr_providers", { configPath: null }));
    expect(invokeMock).toHaveBeenCalledWith("import_amkr_config", {
      configPath: null,
      configRevision: "revision-latest",
      config: { providers: {}, models: {} },
    });
    expect(await screen.findByText("配置已导入，AMKR 已热重载。")).toBeInTheDocument();
  });

  it("edits AMKR listen and timeout settings with the current revision", async () => {
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "get_amkr_settings") return settingsResponse;
      if (command === "update_amkr_settings") return {
        ...settingsResponse,
        config_revision: "revision-next",
        settings: { ...settingsResponse.settings, port: (args as { port: number }).port },
      };
      return undefined;
    });
    render(<SettingsPage configPath={null} metadata={metadata} onConfigPathChange={() => undefined} />);

    fireEvent.change(await screen.findByLabelText("端口"), { target: { value: "19000" } });
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("update_amkr_settings", {
      configPath: null,
      configRevision: "revision-settings",
      host: "127.0.0.1",
      port: 19000,
      requestTimeout: 60,
      streamFirstByteTimeout: 90,
      streamIdleTimeout: 180,
      maxRetries: 2,
    }));
    expect(await screen.findByText("运行设置已保存。监听地址变更将在服务重启后生效。")).toBeInTheDocument();
  });

  it("shows a regenerated local key once after confirmation", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_amkr_settings") return settingsResponse;
      if (command === "regenerate_amkr_local_api_key") return {
        config_revision: "revision-next",
        local_api_key: "replacement-local-key",
        local_api_key_fingerprint: "82ed35081b47",
      };
      return undefined;
    });
    render(<SettingsPage configPath={null} metadata={metadata} onConfigPathChange={() => undefined} />);

    fireEvent.click(await screen.findByRole("button", { name: "重置 Key" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("regenerate_amkr_local_api_key", {
      configPath: null,
      configRevision: "revision-settings",
    }));
    expect(await screen.findByDisplayValue("replacement-local-key")).toBeInTheDocument();
    expect(screen.getByText("本地鉴权 Key 已重置，请立即更新客户端配置。")).toBeInTheDocument();
  });

  it("checks the AMKR version through the management API", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_amkr_settings") return settingsResponse;
      if (command === "check_amkr_update") return {
        current_version: "3.1.0",
        latest_version: "3.2.0",
        release_url: "https://example.test/amkr/3.2.0",
        source: "PyPI",
        update_available: true,
        error: null,
      };
      return undefined;
    });
    render(<SettingsPage configPath={null} metadata={metadata} onConfigPathChange={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("check_amkr_update", { configPath: null }));
    expect(await screen.findByText("3.2.0")).toBeInTheDocument();
    expect(screen.getByText("发现新版本")).toBeInTheDocument();
  });

  it("rejects invalid JSON before calling the service", async () => {
    render(<SettingsPage configPath="C:/amkr.json" metadata={metadata} onConfigPathChange={() => undefined} />);

    fireEvent.change(screen.getByLabelText("可迁移配置"), { target: { value: "{" } });
    fireEvent.click(screen.getByRole("button", { name: "导入配置" }));

    expect(await screen.findByText("配置内容不是有效 JSON。")).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith("import_amkr_config", expect.anything());
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
    expect(invokeMock).toHaveBeenCalledWith("get_amkr_providers", { configPath: "C:/amkr.json" });

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

  it("shows the managed private runtime even before an AMKR config is discovered", async () => {
    invokeMock.mockImplementation(async (command) => command === "get_runtime_installation_status" ? {
      runtime_dir: "C:/Users/test/AppData/Local/Programs/Keyloom/runtime",
      state_path: "C:/Users/test/AppData/Local/Keyloom/install-state.json",
      python_available: true,
      pythonw_available: true,
      amkr_package_available: true,
      private_runtime_installed: true,
      rollback_available: false,
      python_version: "3.12.10",
      amkr_version: "3.1.1",
      amkr_wheel_sha256: "a".repeat(64),
      diagnostic: null,
    } : undefined);

    render(<SettingsPage configPath={null} metadata={null} onConfigPathChange={() => undefined} />);

    expect(await screen.findByText("已安装 · AMKR 3.1.1")).toBeInTheDocument();
    expect(screen.getByText("C:/Users/test/AppData/Local/Programs/Keyloom/runtime")).toBeInTheDocument();
    expect(screen.getByText("aaaaaaaaaaaa…")).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("get_runtime_installation_status");
  });

  it("reports an incomplete private runtime without hiding the selected CLI instance", async () => {
    invokeMock.mockImplementation(async (command) => command === "get_runtime_installation_status" ? {
      runtime_dir: "C:/Users/test/AppData/Local/Programs/Keyloom/runtime",
      state_path: "C:/Users/test/AppData/Local/Keyloom/install-state.json",
      python_available: true,
      pythonw_available: false,
      amkr_package_available: false,
      private_runtime_installed: false,
      rollback_available: false,
      python_version: null,
      amkr_version: null,
      amkr_wheel_sha256: null,
      diagnostic: "私有运行时文件不完整",
    } : undefined);

    render(<SettingsPage configPath={null} metadata={metadata} onConfigPathChange={() => undefined} />);

    expect(await screen.findByText("私有运行时文件不完整")).toBeInTheDocument();
    expect(screen.getByText(metadata.base_url)).toBeInTheDocument();
  });

  it("rolls back to the previous private runtime only after confirmation", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_runtime_installation_status") return {
        runtime_dir: "C:/Users/test/AppData/Local/Programs/Keyloom/runtime",
        state_path: "C:/Users/test/AppData/Local/Keyloom/install-state.json",
        python_available: true,
        pythonw_available: true,
        amkr_package_available: true,
        private_runtime_installed: true,
        rollback_available: true,
        python_version: "3.12.10",
        amkr_version: "3.1.1",
        amkr_wheel_sha256: "a".repeat(64),
        diagnostic: null,
      };
      if (command === "rollback_private_runtime") return {
        runtime_dir: "C:/Users/test/AppData/Local/Programs/Keyloom/runtime",
        state_path: "C:/Users/test/AppData/Local/Keyloom/install-state.json",
        python_available: true,
        pythonw_available: true,
        amkr_package_available: true,
        private_runtime_installed: true,
        rollback_available: true,
        python_version: "3.12.10",
        amkr_version: "3.1.0",
        amkr_wheel_sha256: "b".repeat(64),
        diagnostic: null,
      };
      return undefined;
    });
    render(<SettingsPage configPath={null} metadata={metadata} health={null} onConfigPathChange={() => undefined} />);

    fireEvent.click(await screen.findByRole("button", { name: "回退运行时" }));

    expect(await screen.findByText("已安装 · AMKR 3.1.0")).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("rollback_private_runtime");
  });
});
