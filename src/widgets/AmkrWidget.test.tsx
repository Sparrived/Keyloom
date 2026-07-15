import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AmkrWidget } from "./AmkrWidget";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({
  LogicalSize: class LogicalSize { constructor(public width: number, public height: number) {} },
  PhysicalPosition: class PhysicalPosition { constructor(public x: number, public y: number) {} },
  getCurrentWindow: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

const invokeMock = vi.mocked(invoke);
const getCurrentWindowMock = vi.mocked(getCurrentWindow);
const closeMock = vi.fn().mockResolvedValue(undefined);
const setSizeMock = vi.fn().mockResolvedValue(undefined);
const startDraggingMock = vi.fn().mockResolvedValue(undefined);

describe("AmkrWidget", () => {
  beforeEach(() => {
    localStorage.clear();
    closeMock.mockClear();
    setSizeMock.mockClear();
    startDraggingMock.mockClear();
    getCurrentWindowMock.mockReturnValue({
      close: closeMock,
      onMoved: vi.fn().mockResolvedValue(() => undefined),
      setPosition: vi.fn().mockResolvedValue(undefined),
      setSize: setSizeMock,
      startDragging: startDraggingMock,
    } as never);
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_amkr_metrics") return {
        current_rpm: 12,
        current_tpm: 48_000,
        router_status: "green",
        active_requests: 1,
        total: { requests: 100, successes: 98, total_tokens: 40_000, cached_tokens: 8_000, cached_token_rate: 0.2, avg_duration_ms: 900, avg_first_token_ms: 250 },
        models: { "model-a": { requests: 100, successes: 98, total_tokens: 40_000, cached_token_rate: 0.2, avg_duration_ms: 900 } },
      };
      if (command === "get_amkr_models") return { models: [
        { id: "model-a", aliases: [], routing_mode: "round_robin", reasoning_effort: null, visitor_available: false, keys: [] },
        { id: "model-b", aliases: [], routing_mode: "round_robin", reasoning_effort: null, visitor_available: false, keys: [] },
      ] };
      if (command === "get_amkr_unified_model") return { unified_model: { default: { primary: { model: "model-a", key: "key-a" }, fallback: { model: "backup", key: null } } } };
      if (command === "update_amkr_unified_model") return { unified_model: { default: { primary: { model: "model-b", key: null }, fallback: { model: "backup", key: null } } } };
      return undefined;
    });
  });

  it("fits the native window to the rendered content height", () => {
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ height: 248 } as DOMRect);

    render(<AmkrWidget />);

    expect(setSizeMock).toHaveBeenCalledWith(expect.objectContaining({ width: 360, height: 248 }));
    rect.mockRestore();
  });

  it("renders live AMKR metrics and preserves fallback routing when switching models", async () => {
    render(<AmkrWidget />);

    expect(await screen.findByText("正常")).toBeInTheDocument();
    expect(screen.getByText("48.0K tpm")).toBeInTheDocument();
    expect(screen.getAllByText("98.0%").length).toBeGreaterThan(0);
    fireEvent.click(await screen.findByRole("button", { name: /unified.*model-a/i }));
    fireEvent.click(screen.getByRole("button", { name: "model-b" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("update_amkr_unified_model", {
      configPath: null,
      model: "model-b",
      key: null,
      fallback: { model: "backup", key: null },
      image: null,
    }));
  });

  it("starts native dragging only after moving the held widget header", () => {
    render(<AmkrWidget />);

    const header = screen.getByText("仪表盘").closest("header")!;
    fireEvent.mouseDown(header, { button: 0, clientX: 20, clientY: 20 });
    fireEvent.mouseMove(header, { buttons: 1, clientX: 22, clientY: 22 });
    expect(startDraggingMock).not.toHaveBeenCalled();
    fireEvent.mouseMove(header, { buttons: 1, clientX: 28, clientY: 20 });
    expect(startDraggingMock).toHaveBeenCalledOnce();

    startDraggingMock.mockClear();
    fireEvent.mouseDown(screen.getByRole("button", { name: "关闭 AMKR 挂件" }), { button: 0, clientX: 20, clientY: 20 });
    fireEvent.mouseMove(header, { buttons: 1, clientX: 40, clientY: 20 });
    expect(startDraggingMock).not.toHaveBeenCalled();
  });

  it("disables future startup when closed", async () => {
    localStorage.setItem("keyloom.amkrWidgetEnabled", "true");
    render(<AmkrWidget />);

    fireEvent.click(screen.getByRole("button", { name: "关闭 AMKR 挂件" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("set_amkr_widget_visible", { visible: false }));
    expect(closeMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("keyloom.amkrWidgetEnabled")).toBe("false");
  });
});
