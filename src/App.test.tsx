import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

const invokeMock = vi.mocked(invoke);

describe("Keyloom application shell", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    localStorage.clear();
    invokeMock.mockReset();
    invokeMock
      .mockResolvedValueOnce({
        config_path: "C:/Users/test/AppData/Local/AutoModelKeyRouter/router-config.json",
        base_url: "http://127.0.0.1:18900",
        metrics_db_path: null,
        log_file_path: null,
        auth_enabled: true,
      })
      .mockResolvedValueOnce({
        status: "ok",
        local_auth_enabled: true,
      });
  });

  it("renders all primary navigation destinations", () => {
    render(<App />);

    for (const label of ["概览", "供应商", "模型路由", "活动", "集成", "设置", "服务状态"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("shows the documented service workspace with discovered local details", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "服务状态" }));

    expect(await screen.findByRole("heading", { name: "服务状态" })).toBeInTheDocument();
    expect(screen.getByText("http://127.0.0.1:18900")).toBeInTheDocument();
    expect(screen.getByText("C:/Users/test/AppData/Local/AutoModelKeyRouter/router-config.json")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重启服务" })).toBeInTheDocument();
  });

  it("discovers AMKR at startup and exposes its safe connection status", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("status", { name: "服务状态" })).toHaveTextContent("服务运行中");
    });
    expect(screen.getByText("http://127.0.0.1:18900")).toBeInTheDocument();
    expect(screen.getByText("本地鉴权已启用")).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("discover_amkr", { configPath: null });
    expect(invokeMock).toHaveBeenCalledWith("get_amkr_health", { configPath: null });
  });

  it("restarts the discovered AMKR task through the fixed IPC command", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("status", { name: "服务状态" })).toHaveTextContent("服务运行中");
    });
    invokeMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ status: "ok", local_auth_enabled: true });

    fireEvent.click(screen.getByRole("button", { name: "服务状态" }));
    fireEvent.click(screen.getByRole("button", { name: "重启服务" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("restart_amkr", { configPath: null });
    });
  });

  it("treats a successful stop as stopped without requiring health to respond", async () => {
    invokeMock.mockReset();
    let healthReads = 0;
    invokeMock.mockImplementation(async (command) => {
      if (command === "discover_amkr") return { config_path: "C:/config.json", base_url: "http://127.0.0.1:18900", metrics_db_path: null, log_file_path: null, auth_enabled: true };
      if (command === "get_amkr_health") { healthReads += 1; return { status: "ok", local_auth_enabled: true }; }
      if (command === "get_amkr_metrics") return { total: { requests: 0, total_tokens: 0, cached_token_rate: 0, avg_duration_ms: 0 } };
      if (command === "stop_amkr") return [{ command: ["schtasks"], exit_code: 0, stdout: "SUCCESS", stderr: "" }];
      return undefined;
    });

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "服务状态" }));
    expect(screen.getByRole("button", { name: "启动服务" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "停止服务" }));

    expect(await screen.findByText("服务已停止。")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "服务状态" })).toHaveTextContent("服务未运行");
    expect(screen.getByRole("button", { name: "停止服务" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "启动服务" })).toBeEnabled();
    expect(screen.queryByText(/服务操作失败/)).not.toBeInTheDocument();
    expect(healthReads).toBe(1);
  });

  it("retries health while a started service becomes ready", async () => {
    vi.useFakeTimers();
    invokeMock.mockReset();
    let healthReads = 0;
    invokeMock.mockImplementation(async (command) => {
      if (command === "discover_amkr") return { config_path: "C:/config.json", base_url: "http://127.0.0.1:18900", metrics_db_path: null, log_file_path: null, auth_enabled: true };
      if (command === "get_amkr_health") {
        healthReads += 1;
        if (healthReads < 4) throw new Error("connection refused");
        return { status: "ok", local_auth_enabled: true };
      }
      if (command === "get_amkr_metrics") return { total: { requests: 0, total_tokens: 0, cached_token_rate: 0, avg_duration_ms: 0 } };
      if (command === "start_amkr") return [];
      return undefined;
    });

    render(<App />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    fireEvent.click(screen.getByRole("button", { name: "服务状态" }));
    fireEvent.click(screen.getByRole("button", { name: "启动服务" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1_001); });

    expect(screen.getByText("服务已启动。")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "服务状态" })).toHaveTextContent("服务运行中");
    expect(healthReads).toBe(4);
  });

  it("requires confirmation before removing the login task", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "服务状态" }));

    fireEvent.click(screen.getByRole("button", { name: "取消注册" }));

    expect(invokeMock).not.toHaveBeenCalledWith("uninstall_amkr", expect.anything());
  });

  it("manages the user startup task through fixed IPC commands", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command) => {
      if (command === "discover_amkr") return { config_path: "C:/config.json", base_url: "http://127.0.0.1:18900", metrics_db_path: null, log_file_path: null, auth_enabled: true };
      if (command === "get_amkr_health") return { status: "ok", local_auth_enabled: true };
      if (command === "get_amkr_metrics") return { total: { requests: 0, total_tokens: 0, cached_token_rate: 0, avg_duration_ms: 0 } };
      if (command === "status_amkr") return [{ command: ["schtasks"], exit_code: 0, stdout: "Status: Ready", stderr: "" }];
      return [];
    });

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "服务状态" }));
    fireEvent.click(screen.getByRole("button", { name: "注册登录启动" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("install_user_amkr", { configPath: null }));

    fireEvent.click(screen.getByRole("button", { name: "查询任务" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("status_amkr", { configPath: null }));
    expect(await screen.findByText("Status: Ready")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "取消注册" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("uninstall_amkr", { configPath: null }));
  });

  it("renders the V5 overview with unified model and real metrics", async () => {
    invokeMock.mockReset();
    invokeMock
      .mockResolvedValueOnce({
        config_path: "C:/Users/test/AppData/Local/AutoModelKeyRouter/router-config.json",
        base_url: "http://127.0.0.1:18900",
        metrics_db_path: null,
        log_file_path: null,
        auth_enabled: true,
      })
      .mockResolvedValueOnce({
        status: "ok",
        local_auth_enabled: true,
        unified_model: {
          default: { primary: { model: "gpt-5.5", key: null } },
        },
      })
      .mockResolvedValueOnce({
        total: {
          requests: 1428,
          total_tokens: 2_840_000,
          cached_token_rate: 0.68,
          avg_duration_ms: 1200,
        },
      });

    render(<App />);

    expect(await screen.findByText("统一模型")).toBeInTheDocument();
    expect(screen.getByText("gpt-5.5")).toBeInTheDocument();
    expect(screen.getByText("数据总览")).toBeInTheDocument();
    expect(screen.getAllByText("1,428").length).toBeGreaterThan(0);
    expect(screen.getByText("2.84M")).toBeInTheDocument();
    expect(screen.getByText("68%")).toBeInTheDocument();
    expect(screen.getByText("1.2s")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开服务" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "请求" })).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("get_amkr_metrics", { configPath: null });
  });

  it("shows real metric snapshots on the activity page", async () => {
    render(<App />);

    await screen.findByRole("status", { name: "服务状态" });
    fireEvent.click(screen.getByRole("button", { name: "活动" }));

    expect(screen.getByRole("button", { name: "活动" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "活动" })).toBeInTheDocument();
    expect(screen.getByText("尚未获取到可用的服务指标。")).toBeInTheDocument();
  });

  it("shows discovered connection details in settings", async () => {
    render(<App />);
    await screen.findByRole("status", { name: "服务状态" });
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    expect(screen.getByText("当前 AMKR 实例的只读连接摘要。")).toBeInTheDocument();
    expect(screen.getByText("服务地址")).toBeInTheDocument();
    expect(screen.getByText("http://127.0.0.1:18900")).toBeInTheDocument();
  });

  it("rediscovers AMKR from a manually selected config path", async () => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command, args) => {
      const configPath = (args as { configPath?: string | null } | undefined)?.configPath;
      if (command === "discover_amkr") {
        return {
          config_path: configPath ?? "C:/default/router-config.json",
          base_url: configPath ? "http://127.0.0.1:19000" : "http://127.0.0.1:18900",
          metrics_db_path: null,
          log_file_path: null,
          auth_enabled: true,
        };
      }
      if (command === "get_amkr_health") return { status: "ok", local_auth_enabled: true };
      if (command === "get_amkr_metrics") return { total: { requests: 0, total_tokens: 0, cached_token_rate: 0, avg_duration_ms: 0 } };
      return undefined;
    });

    render(<App />);
    await screen.findByText("http://127.0.0.1:18900");
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    fireEvent.change(screen.getByLabelText("配置路径"), { target: { value: "D:/amkr/custom.json" } });
    fireEvent.click(screen.getByRole("button", { name: "使用配置" }));

    expect(await screen.findByText("http://127.0.0.1:19000")).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("discover_amkr", { configPath: "D:/amkr/custom.json" });
    expect(localStorage.getItem("keyloom.configPath")).toBe("D:/amkr/custom.json");
  });

  it("uses the remembered AMKR config path at startup", async () => {
    localStorage.setItem("keyloom.configPath", "D:/amkr/remembered.json");
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command, args) => {
      const configPath = (args as { configPath?: string | null } | undefined)?.configPath;
      if (command === "discover_amkr") return { config_path: configPath, base_url: "http://127.0.0.1:19100", metrics_db_path: null, log_file_path: null, auth_enabled: true };
      if (command === "get_amkr_health") return { status: "ok", local_auth_enabled: true };
      if (command === "get_amkr_metrics") return { total: { requests: 0, total_tokens: 0, cached_token_rate: 0, avg_duration_ms: 0 } };
      return undefined;
    });

    render(<App />);

    expect(await screen.findByText("http://127.0.0.1:19100")).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("discover_amkr", { configPath: "D:/amkr/remembered.json" });
  });

  it("selects a usage trend metric", async () => {
    render(<App />);

    await screen.findByRole("button", { name: "请求" });
    fireEvent.click(screen.getByRole("button", { name: "Token" }));

    expect(screen.getByRole("button", { name: "Token" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "请求" })).toHaveAttribute("aria-pressed", "false");
  });

  it("refreshes the service health every five seconds after discovery", async () => {
    vi.useFakeTimers();
    invokeMock.mockReset();
    invokeMock
      .mockResolvedValueOnce({
        config_path: "C:/Users/test/AppData/Local/AutoModelKeyRouter/router-config.json",
        base_url: "http://127.0.0.1:18900",
        metrics_db_path: null,
        log_file_path: null,
        auth_enabled: true,
      })
      .mockResolvedValueOnce({ status: "ok", local_auth_enabled: true })
      .mockResolvedValueOnce({
        total: { requests: 0, total_tokens: 0, cached_token_rate: 0, avg_duration_ms: 0 },
      })
      .mockResolvedValueOnce({ status: "ok", local_auth_enabled: true });

    render(<App />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(5_001);
    });

    expect(invokeMock).toHaveBeenCalledTimes(4);
    expect(invokeMock).toHaveBeenLastCalledWith("get_amkr_health", { configPath: null });
    vi.useRealTimers();
  });

  it("shows a disconnected state when a health refresh fails", async () => {
    vi.useFakeTimers();
    invokeMock.mockReset();
    invokeMock
      .mockResolvedValueOnce({
        config_path: "C:/Users/test/AppData/Local/AutoModelKeyRouter/router-config.json",
        base_url: "http://127.0.0.1:18900",
        metrics_db_path: null,
        log_file_path: null,
        auth_enabled: true,
      })
      .mockResolvedValueOnce({ status: "ok", local_auth_enabled: true })
      .mockResolvedValueOnce({
        total: { requests: 0, total_tokens: 0, cached_token_rate: 0, avg_duration_ms: 0 },
      })
      .mockRejectedValueOnce(new Error("connection refused"));

    render(<App />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(5_001);
    });

    expect(screen.getByRole("status", { name: "服务状态" })).toHaveTextContent("服务未连接");
    vi.useRealTimers();
  });

  it("loads redacted providers when the providers page opens", async () => {
    invokeMock.mockReset();
    invokeMock
      .mockResolvedValueOnce({
        config_path: "C:/Users/test/AppData/Local/AutoModelKeyRouter/router-config.json",
        base_url: "http://127.0.0.1:18900",
        metrics_db_path: null,
        log_file_path: null,
        auth_enabled: true,
      })
      .mockResolvedValueOnce({ status: "ok", local_auth_enabled: true })
      .mockResolvedValueOnce({
        total: { requests: 0, total_tokens: 0, cached_token_rate: 0, avg_duration_ms: 0 },
      })
      .mockResolvedValueOnce({
        config_revision: "revision-a",
        providers: [
          {
            id: "a.example.test",
            base_url: "https://a.example.test",
            keys: [
              {
                name: "key-a",
                enabled: true,
                allow_visitor: false,
                api_key_fingerprint: "65bbff9a6cb9",
              },
            ],
            pools: [{ name: "model-a", keys: ["key-a"], models: ["model-a"] }],
          },
        ],
      });

    render(<App />);
    await screen.findByRole("status", { name: "服务状态" });
    fireEvent.click(screen.getByRole("button", { name: "供应商" }));

    expect(await screen.findByText("a.example.test")).toBeInTheDocument();
    expect(screen.getByText("65bbff9a6cb9")).toBeInTheDocument();
    expect(screen.getAllByText("model-a")).toHaveLength(2);
    expect(invokeMock).toHaveBeenCalledWith("get_amkr_providers", { configPath: null });
  });

  it("creates a provider with the current revision and refreshes the list", async () => {
    invokeMock.mockReset();
    let created = false;
    invokeMock.mockImplementation(async (command) => {
      if (command === "discover_amkr") return { config_path: "C:/config.json", base_url: "http://127.0.0.1:18900", metrics_db_path: null, log_file_path: null, auth_enabled: true };
      if (command === "get_amkr_health") return { status: "ok", local_auth_enabled: true };
      if (command === "get_amkr_metrics") return { total: { requests: 0, total_tokens: 0, cached_token_rate: 0, avg_duration_ms: 0 } };
      if (command === "create_amkr_provider") { created = true; return { config_revision: "revision-b", provider: { id: "b.example.test" } }; }
      if (command === "get_amkr_providers") return { config_revision: created ? "revision-b" : "revision-a", providers: created ? [{ id: "b.example.test", base_url: "https://b.example.test", keys: [], pools: [] }] : [] };
      return undefined;
    });

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "供应商" }));
    await screen.findByText("尚未配置供应商。");
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "b.example.test" } });
    fireEvent.change(screen.getByLabelText("地址"), { target: { value: "https://b.example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "添加供应商" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("create_amkr_provider", { configPath: null, configRevision: "revision-a", id: "b.example.test", baseUrl: "https://b.example.test" }));
    expect(await screen.findByText("b.example.test")).toBeInTheDocument();
  });

  it("loads model routes when the routing page opens", async () => {
    invokeMock.mockReset();
    invokeMock
      .mockResolvedValueOnce({
        config_path: "C:/Users/test/AppData/Local/AutoModelKeyRouter/router-config.json",
        base_url: "http://127.0.0.1:18900",
        metrics_db_path: null,
        log_file_path: null,
        auth_enabled: true,
      })
      .mockResolvedValueOnce({ status: "ok", local_auth_enabled: true })
      .mockResolvedValueOnce({
        total: { requests: 0, total_tokens: 0, cached_token_rate: 0, avg_duration_ms: 0 },
      })
      .mockResolvedValueOnce({
        config_revision: "revision-a",
        routes: [
          {
            id: "model-a",
            aliases: ["alias-a"],
            routing_mode: "priority",
            targets: [
              { provider: "a.example.test", pool: "model-a", upstream_model: "upstream-a" },
            ],
          },
        ],
      });

    render(<App />);
    await screen.findByRole("status", { name: "服务状态" });
    fireEvent.click(screen.getByRole("button", { name: "模型路由" }));

    expect(await screen.findByText("model-a")).toBeInTheDocument();
    expect(screen.getByText("alias-a")).toBeInTheDocument();
    expect(screen.getByText("a.example.test / model-a / upstream-a")).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("get_amkr_routes", { configPath: null });
  });
});
