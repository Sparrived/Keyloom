import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntegrationsPage } from "./IntegrationsPage";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";

const invokeMock = vi.mocked(invoke);

describe("IntegrationsPage", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    invokeMock.mockImplementation(async (command, args) => command === "get_agent_integration_status" && (args as { agent?: string } | undefined)?.agent === "claude-code"
      ? {
        agent: "claude-code",
        display_name: "Claude Code",
        target_path: "C:/Users/test/.claude/settings.json",
        target_exists: true,
        backup_available: true,
        current_is_applied: true,
        mode: "unified-model",
      }
      : command === "get_agent_integration_status" ? {
        agent: "codex",
        display_name: "Codex",
        target_path: "C:/Users/test/.codex/config.toml",
        target_exists: false,
        backup_available: false,
        current_is_applied: false,
        mode: null,
      } : undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it("shows discovered agent config paths and managed modes", async () => {
    render(<IntegrationsPage configPath={null} baseUrl="http://127.0.0.1:18900" authEnabled />);

    expect(await screen.findByText("已接管 · unified-model")).toBeInTheDocument();
    expect(screen.getByText(/C:\/Users\/test\/.claude\/settings\.json/)).toBeInTheDocument();
    expect(screen.getByText("未找到配置")).toBeInTheDocument();
    expect(screen.getByText(/C:\/Users\/test\/.codex\/config\.toml/)).toBeInTheDocument();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("get_agent_integration_status", { agent: "codex" }));
  });

  it("keeps the service summary when agent discovery fails", async () => {
    invokeMock.mockRejectedValue(new Error("无法读取集成状态"));
    render(<IntegrationsPage configPath={null} baseUrl="http://127.0.0.1:18900" authEnabled={false} />);

    expect(await screen.findAllByText("操作失败")).toHaveLength(2);
    expect(screen.getAllByText("无法读取集成状态")).toHaveLength(2);
    expect(screen.getByText(/目标地址 http:\/\/127\.0\.0\.1:18900/)).toBeInTheDocument();
  });

  it("applies the selected routing mode through the private runtime", async () => {
    invokeMock.mockImplementation(async (command, args) => {
      const agent = (args as { agent?: string } | undefined)?.agent;
      if (command === "get_agent_integration_status") return {
        agent,
        display_name: agent === "codex" ? "Codex" : "Claude Code",
        target_path: `C:/Users/test/.${agent}/config`,
        target_exists: false,
        backup_available: false,
        current_is_applied: false,
        mode: null,
      };
      if (command === "configure_agent_integration") return {
        agent: "codex",
        display_name: "Codex",
        target_path: "C:/Users/test/.codex/config.toml",
        target_exists: true,
        backup_available: true,
        current_is_applied: true,
        mode: "native",
      };
      return undefined;
    });
    render(<IntegrationsPage configPath="C:/AMKR/router-config.json" baseUrl="http://127.0.0.1:18900" authEnabled />);
    const codex = (await screen.findByRole("heading", { name: "Codex" })).closest("article");
    expect(codex).not.toBeNull();

    fireEvent.change(within(codex!).getByLabelText("路由模式"), { target: { value: "native" } });
    fireEvent.click(within(codex!).getByRole("button", { name: "应用" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("configure_agent_integration", {
      configPath: "C:/AMKR/router-config.json",
      agent: "codex",
      mode: "native",
    }));
    expect(await within(codex!).findByText("已接管 · native")).toBeInTheDocument();
  });

  it("rolls back an applied integration after confirmation", async () => {
    invokeMock.mockImplementation(async (command, args) => {
      const agent = (args as { agent?: string } | undefined)?.agent ?? "claude-code";
      if (command === "rollback_agent_integration") return {
        agent,
        display_name: "Claude Code",
        target_path: "C:/Users/test/.claude/settings.json",
        target_exists: true,
        backup_available: false,
        current_is_applied: false,
        mode: null,
      };
      return {
        agent,
        display_name: agent === "codex" ? "Codex" : "Claude Code",
        target_path: `C:/Users/test/.${agent}/config`,
        target_exists: true,
        backup_available: agent === "claude-code",
        current_is_applied: agent === "claude-code",
        mode: agent === "claude-code" ? "unified-model" : null,
      };
    });
    render(<IntegrationsPage configPath={null} baseUrl="http://127.0.0.1:18900" authEnabled />);
    const claude = (await screen.findByRole("heading", { name: "Claude Code" })).closest("article");

    fireEvent.click(within(claude!).getByRole("button", { name: "回退" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("rollback_agent_integration", { agent: "claude-code" }));
    expect(window.confirm).toHaveBeenCalled();
    expect(await within(claude!).findByText("检测到配置")).toBeInTheDocument();
  });
});
