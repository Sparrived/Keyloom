import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProbePanel } from "./ProbePanel";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";

const invokeMock = vi.mocked(invoke);

describe("ProbePanel", () => {
  beforeEach(() => invokeMock.mockReset());

  it("starts a selected key probe and renders the redacted result", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "probe_amkr_keys") return { probe_id: "probe-1", status: "pending" };
      if (command === "get_amkr_probe") {
        return {
          probe_id: "probe-1",
          status: "complete",
          provider: "a.example.test",
          results: [{
            status: "ok",
            provider: "a.example.test",
            key: "key-a",
            endpoint: "https://a.example.test/v1/chat/completions",
            models: ["model-a"],
            latency_ms: 123,
            error: null,
          }],
          error: null,
        };
      }
      return undefined;
    });

    render(<ProbePanel configPath={null} providerId="a.example.test" keys={["key-a", "key-b"]} pools={["pool-a"]} />);
    fireEvent.click(screen.getByRole("button", { name: "探测 Key key-a" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("probe_amkr_keys", {
      configPath: null,
      providerId: "a.example.test",
      keys: ["key-a"],
      timeoutSeconds: 15,
    }));
    expect(await screen.findByText("https://a.example.test/v1/chat/completions")).toBeInTheDocument();
    expect(screen.getByText("model-a")).toBeInTheDocument();
    expect(screen.getByText("123 ms")).toBeInTheDocument();
    expect(screen.queryByText("upstream-secret")).not.toBeInTheDocument();
  });

  it("starts a pool probe with the selected pool", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "probe_amkr_pools") return { probe_id: "probe-pool", status: "pending" };
      if (command === "get_amkr_probe") return {
        probe_id: "probe-pool",
        status: "complete",
        provider: "a.example.test",
        results: [],
        error: null,
      };
      return undefined;
    });

    render(<ProbePanel configPath="C:/amkr.json" providerId="a.example.test" keys={["key-a"]} pools={["pool-a", "pool-b"]} />);
    fireEvent.click(screen.getByRole("button", { name: "探测模型池 pool-b" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("probe_amkr_pools", {
      configPath: "C:/amkr.json",
      providerId: "a.example.test",
      pools: ["pool-b"],
      timeoutSeconds: 15,
    }));
  });

  it("cancels an active probe and disables duplicate starts", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "probe_amkr_keys") return { probe_id: "probe-running", status: "pending" };
      if (command === "get_amkr_probe") return {
        probe_id: "probe-running",
        status: "running",
        provider: "a.example.test",
        results: [],
        error: null,
      };
      if (command === "cancel_amkr_probe") return {
        probe_id: "probe-running",
        status: "cancelled",
        provider: "a.example.test",
        results: [],
        error: null,
      };
      return undefined;
    });

    render(<ProbePanel configPath={null} providerId="a.example.test" keys={["key-a"]} pools={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "探测 Key key-a" }));
    expect(await screen.findByRole("button", { name: "取消探测" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "探测 Key key-a" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "取消探测" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("cancel_amkr_probe", {
      configPath: null,
      probeId: "probe-running",
    }));
    expect(await screen.findByText("已取消")).toBeInTheDocument();
  });

  it("cancels and stops an in-flight probe when the panel unmounts", async () => {
    let resolveStatus: ((value: unknown) => void) | undefined;
    const statusPromise = new Promise((resolve) => { resolveStatus = resolve; });
    invokeMock.mockImplementation(async (command) => {
      if (command === "probe_amkr_keys") return { probe_id: "probe-unmount", status: "pending" };
      if (command === "get_amkr_probe") return statusPromise;
      if (command === "cancel_amkr_probe") return {
        probe_id: "probe-unmount",
        status: "cancelled",
        provider: "a.example.test",
        results: [],
        error: null,
      };
      return undefined;
    });

    const { unmount } = render(<ProbePanel configPath={null} providerId="a.example.test" keys={["key-a"]} pools={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "探测 Key key-a" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("get_amkr_probe", {
      configPath: null,
      probeId: "probe-unmount",
    }));
    unmount();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("cancel_amkr_probe", {
      configPath: null,
      probeId: "probe-unmount",
    }));
    resolveStatus?.({
      probe_id: "probe-unmount",
      status: "running",
      provider: "a.example.test",
      results: [],
      error: null,
    });
  });
});
