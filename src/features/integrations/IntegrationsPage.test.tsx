import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntegrationsPage } from "./IntegrationsPage";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";

const invokeMock = vi.mocked(invoke);

describe("IntegrationsPage", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (_command, args) => (args as { agent?: string } | undefined)?.agent === "claude-code"
      ? {
        agent: "claude-code",
        display_name: "Claude Code",
        target_path: "C:/Users/test/.claude/settings.json",
        target_exists: true,
        backup_available: true,
        mode: "unified-model",
      }
      : {
        agent: "codex",
        display_name: "Codex",
        target_path: "C:/Users/test/.codex/config.toml",
        target_exists: false,
        backup_available: false,
        mode: null,
      });
  });

  it("shows discovered agent config paths and managed modes", async () => {
    render(<IntegrationsPage baseUrl="http://127.0.0.1:18900" authEnabled />);

    expect(await screen.findByText("已接管 · unified-model")).toBeInTheDocument();
    expect(screen.getByText(/C:\/Users\/test\/.claude\/settings\.json/)).toBeInTheDocument();
    expect(screen.getByText("未找到配置")).toBeInTheDocument();
    expect(screen.getByText(/C:\/Users\/test\/.codex\/config\.toml/)).toBeInTheDocument();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("get_agent_integration_status", { agent: "codex" }));
  });

  it("keeps the service summary when agent discovery fails", async () => {
    invokeMock.mockRejectedValue(new Error("无法读取集成状态"));
    render(<IntegrationsPage baseUrl="http://127.0.0.1:18900" authEnabled={false} />);

    expect(await screen.findAllByText("无法读取")).toHaveLength(2);
    expect(screen.getByText(/目标地址 http:\/\/127\.0\.0\.1:18900/)).toBeInTheDocument();
  });
});
