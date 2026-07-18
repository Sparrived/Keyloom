import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AmkrWidget } from "./AmkrWidget";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({
  LogicalSize: class LogicalSize { constructor(public width: number, public height: number) {} },
  PhysicalPosition: class PhysicalPosition { constructor(public x: number, public y: number) {} },
  availableMonitors: vi.fn(),
  primaryMonitor: vi.fn(),
  getCurrentWindow: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { availableMonitors, getCurrentWindow, primaryMonitor } from "@tauri-apps/api/window";
import { defaultWidgetPosition, isWidgetVisibleOnMonitors } from "./AmkrWidget";

const invokeMock = vi.mocked(invoke);
const getCurrentWindowMock = vi.mocked(getCurrentWindow);
const availableMonitorsMock = vi.mocked(availableMonitors);
const primaryMonitorMock = vi.mocked(primaryMonitor);
const closeMock = vi.fn().mockResolvedValue(undefined);
const setSizeMock = vi.fn().mockResolvedValue(undefined);
const setPositionMock = vi.fn().mockResolvedValue(undefined);
const outerPositionMock = vi.fn().mockResolvedValue({ x: 100, y: 100 });
const outerSizeMock = vi.fn().mockResolvedValue({ width: 360, height: 390 });
const startDraggingMock = vi.fn().mockResolvedValue(undefined);

const primaryMonitorFixture = {
  name: "Primary",
  size: { width: 1920, height: 1080 },
  position: { x: 0, y: 0 },
  workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 } },
  scaleFactor: 1,
};

describe("AmkrWidget", () => {
  beforeEach(() => {
    localStorage.clear();
    closeMock.mockClear();
    setSizeMock.mockClear();
    setPositionMock.mockClear();
    outerPositionMock.mockReset();
    outerPositionMock.mockResolvedValue({ x: 100, y: 100 });
    outerSizeMock.mockReset();
    outerSizeMock.mockResolvedValue({ width: 360, height: 390 });
    startDraggingMock.mockClear();
    availableMonitorsMock.mockReset();
    availableMonitorsMock.mockResolvedValue([primaryMonitorFixture] as never);
    primaryMonitorMock.mockReset();
    primaryMonitorMock.mockResolvedValue(primaryMonitorFixture as never);
    getCurrentWindowMock.mockReturnValue({
      close: closeMock,
      onMoved: vi.fn().mockResolvedValue(() => undefined),
      outerPosition: outerPositionMock,
      outerSize: outerSizeMock,
      setPosition: setPositionMock,
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


  it("keeps a saved on-screen position", async () => {
    localStorage.setItem("keyloom.amkrWidgetPosition", JSON.stringify({ x: 120, y: 80 }));
    outerPositionMock.mockResolvedValue({ x: 120, y: 80 });

    render(<AmkrWidget />);

    await waitFor(() => expect(setPositionMock).toHaveBeenCalledWith(expect.objectContaining({ x: 120, y: 80 })));
    expect(setPositionMock).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("keyloom.amkrWidgetPosition")).toBe(JSON.stringify({ x: 120, y: 80 }));
  });

  it("resets the widget when the saved position is off every monitor", async () => {
    localStorage.setItem("keyloom.amkrWidgetPosition", JSON.stringify({ x: 5000, y: 100 }));
    outerPositionMock.mockResolvedValue({ x: 5000, y: 100 });

    render(<AmkrWidget />);

    const expected = defaultWidgetPosition({ width: 360, height: 390 }, primaryMonitorFixture as never);
    await waitFor(() => expect(setPositionMock).toHaveBeenCalledWith(expect.objectContaining(expected)));
    expect(localStorage.getItem("keyloom.amkrWidgetPosition")).toBe(JSON.stringify(expected));
  });

  it("detects off-screen positions with the visibility helper", () => {
    expect(isWidgetVisibleOnMonitors({ x: 100, y: 100 }, { width: 360, height: 390 }, [primaryMonitorFixture as never])).toBe(true);
    expect(isWidgetVisibleOnMonitors({ x: 5000, y: 100 }, { width: 360, height: 390 }, [primaryMonitorFixture as never])).toBe(false);
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
