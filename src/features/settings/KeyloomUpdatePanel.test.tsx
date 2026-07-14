import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeyloomUpdatePanel } from "./KeyloomUpdatePanel";

vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

const checkMock = vi.mocked(check);
const relaunchMock = vi.mocked(relaunch);

function availableUpdate() {
  return {
    currentVersion: "0.1.0",
    version: "0.2.0",
    body: "修复更新流程",
    close: vi.fn().mockResolvedValue(undefined),
    downloadAndInstall: vi.fn().mockImplementation(async (onEvent) => {
      onEvent?.({ event: "Started", data: { contentLength: 100 } });
      onEvent?.({ event: "Progress", data: { chunkLength: 100 } });
      onEvent?.({ event: "Finished" });
    }),
  };
}

describe("KeyloomUpdatePanel", () => {
  afterEach(() => vi.restoreAllMocks());

  beforeEach(() => {
    checkMock.mockReset();
    relaunchMock.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("reports when Keyloom is current", async () => {
    checkMock.mockResolvedValue(null);
    render(<KeyloomUpdatePanel />);

    fireEvent.click(screen.getByRole("button", { name: "检查 Keyloom 更新" }));

    expect(await screen.findByText("当前已是最新版本")).toBeInTheDocument();
    expect(screen.getAllByText("0.1.0")).toHaveLength(2);
  });

  it("refreshes an update detected by the application shell", async () => {
    checkMock.mockResolvedValue(availableUpdate() as never);

    render(<KeyloomUpdatePanel detectedVersion="0.2.0" />);

    await waitFor(() => expect(checkMock).toHaveBeenCalledOnce());
    expect(screen.getByText("发现新版本")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下载并安装" })).toBeInTheDocument();
  });

  it("downloads, installs, and relaunches an available update", async () => {
    const update = availableUpdate();
    checkMock.mockResolvedValue(update as never);
    relaunchMock.mockResolvedValue(undefined);
    render(<KeyloomUpdatePanel />);

    fireEvent.click(screen.getByRole("button", { name: "检查 Keyloom 更新" }));
    expect(await screen.findByText("0.2.0")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下载并安装" }));

    await waitFor(() => expect(update.downloadAndInstall).toHaveBeenCalledOnce());
    expect(relaunchMock).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "正在重启 Keyloom" })).toBeDisabled();
  });
});
