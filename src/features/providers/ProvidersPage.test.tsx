import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProvidersPage } from "./ProvidersPage";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";

const invokeMock = vi.mocked(invoke);
const response = {
  config_revision: "revision-a",
  providers: [{
    id: "a.example.test",
    base_url: "https://a.example.test",
    keys: [{ name: "key-a", enabled: true, allow_visitor: false, api_key_fingerprint: "65bbff9a6cb9" }],
    pools: [{ name: "pool-a", keys: ["key-a"], models: ["model-a"] }],
    routes: { openai: "proxy/v1/chat/completions" },
  }],
};

describe("ProvidersPage", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command) => {
      if (command === "probe_amkr_pools") return { probe_id: "probe-pools", status: "pending" };
      if (command === "get_amkr_probe") return { probe_id: "probe-pools", status: "complete", provider: "a.example.test", results: [], error: null };
      return response;
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("edits a provider without rebuilding its keys and pools", async () => {
    render(<ProvidersPage configPath="C:/amkr.json" />);
    await screen.findByText("a.example.test");

    fireEvent.click(screen.getByRole("button", { name: "编辑供应商 a.example.test" }));
    fireEvent.change(screen.getByLabelText("供应商名称"), { target: { value: "b.example.test" } });
    fireEvent.change(screen.getByLabelText("供应商地址"), { target: { value: "https://b.example.test" } });
    fireEvent.change(screen.getByLabelText("Anthropic 路径"), { target: { value: "gateway/v1/messages" } });
    fireEvent.click(screen.getByRole("button", { name: "保存供应商" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("update_amkr_provider", {
      configPath: "C:/amkr.json",
      configRevision: "revision-a",
      providerId: "a.example.test",
      id: "b.example.test",
      baseUrl: "https://b.example.test",
      routes: {
        openai: "proxy/v1/chat/completions",
        anthropic: "gateway/v1/messages",
      },
    }));
  });

  it("refreshes a conflicting revision without discarding the provider draft", async () => {
    let providerReads = 0;
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_amkr_providers") {
        providerReads += 1;
        return { ...response, config_revision: providerReads === 1 ? "revision-a" : "revision-b" };
      }
      if (command === "update_amkr_provider" && providerReads === 1) {
        throw new Error("AMKR 更新供应商请求失败（HTTP 409）: 配置已被其他客户端修改");
      }
      return undefined;
    });
    render(<ProvidersPage configPath={null} />);
    await screen.findByText("a.example.test");

    fireEvent.click(screen.getByRole("button", { name: "编辑供应商 a.example.test" }));
    fireEvent.change(screen.getByLabelText("供应商名称"), { target: { value: "b.example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "保存供应商" }));

    expect(await screen.findByText(/HTTP 409/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("版本 revision-b")).toBeInTheDocument());
    expect(screen.getByLabelText("供应商名称")).toHaveValue("b.example.test");

    fireEvent.click(screen.getByRole("button", { name: "保存供应商" }));
    await waitFor(() => expect(invokeMock).toHaveBeenLastCalledWith("get_amkr_providers", { configPath: null }));
    expect(invokeMock).toHaveBeenCalledWith("update_amkr_provider", expect.objectContaining({ configRevision: "revision-b" }));
  });

  it("updates and deletes a provider key", async () => {
    render(<ProvidersPage configPath={null} />);
    await screen.findByText("key-a");

    fireEvent.click(screen.getByRole("button", { name: "编辑 Key key-a" }));
    fireEvent.click(screen.getByLabelText("启用 Key"));
    fireEvent.click(screen.getByLabelText("允许访客"));
    fireEvent.change(screen.getByLabelText("替换 API Key"), { target: { value: "replacement-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "保存 Key" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("update_amkr_provider_key", {
      configPath: null,
      configRevision: "revision-a",
      providerId: "a.example.test",
      keyName: "key-a",
      name: "key-a",
      apiKey: "replacement-secret",
      enabled: false,
      allowVisitor: true,
    }));

    fireEvent.click(screen.getByRole("button", { name: "删除 Key key-a" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("delete_amkr_provider_key", {
      configPath: null,
      configRevision: "revision-a",
      providerId: "a.example.test",
      keyName: "key-a",
    }));
  });

  it("updates and deletes a model pool", async () => {
    render(<ProvidersPage configPath={null} />);
    await screen.findByText("pool-a");

    fireEvent.click(screen.getByRole("button", { name: "编辑模型池 pool-a" }));
    fireEvent.change(screen.getByLabelText("模型池名称"), { target: { value: "pool-b" } });
    fireEvent.change(screen.getByLabelText("模型池 Key"), { target: { value: "key-a,key-b" } });
    fireEvent.change(screen.getByLabelText("自定义模型"), { target: { value: "model-b" } });
    fireEvent.click(screen.getByRole("button", { name: "保存模型池" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("update_amkr_pool", {
      configPath: null,
      configRevision: "revision-a",
      providerId: "a.example.test",
      poolName: "pool-a",
      name: "pool-b",
      keys: ["key-a", "key-b"],
      models: ["model-a", "model-b"],
    }));

    fireEvent.click(screen.getByRole("button", { name: "删除模型池 pool-a" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("delete_amkr_pool", {
      configPath: null,
      configRevision: "revision-a",
      providerId: "a.example.test",
      poolName: "pool-a",
    }));
  });

  it("probes the edited pool and combines discovered and custom models", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_amkr_providers") return response;
      if (command === "probe_amkr_pools") return { probe_id: "probe-pools", status: "pending" };
      if (command === "get_amkr_probe") return {
        probe_id: "probe-pools",
        status: "complete",
        provider: "a.example.test",
        results: [{ status: "ok", provider: "a.example.test", key: "key-a", endpoint: "https://a.example.test/v1/models", models: ["model-a", "model-b"], latency_ms: 20, error: null }],
        error: null,
      };
      return undefined;
    });
    render(<ProvidersPage configPath={null} />);
    await screen.findByText("pool-a");

    fireEvent.click(screen.getByRole("button", { name: "编辑模型池 pool-a" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("probe_amkr_pools", {
      configPath: null,
      providerId: "a.example.test",
      pools: ["pool-a"],
      timeoutSeconds: 15,
    }));
    fireEvent.change(await screen.findByLabelText("选择探测模型"), { target: { value: "model-b" } });
    expect(screen.getByLabelText("已选模型")).toHaveTextContent("model-a");
    expect(screen.getByLabelText("已选模型")).toHaveTextContent("model-b");
    fireEvent.change(screen.getByLabelText("自定义模型"), { target: { value: "custom-model" } });
    fireEvent.click(screen.getByRole("button", { name: "保存模型池" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("update_amkr_pool", expect.objectContaining({
      models: ["model-a", "model-b", "custom-model"],
    })));
  });

  it("collapses each editor from its edit button", async () => {
    render(<ProvidersPage configPath={null} />);
    await screen.findByText("a.example.test");

    fireEvent.click(screen.getByRole("button", { name: "编辑供应商 a.example.test" }));
    expect(screen.getByLabelText("供应商名称")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "收起供应商 a.example.test" }));
    expect(screen.queryByLabelText("供应商名称")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "编辑 Key key-a" }));
    expect(screen.getByLabelText("Key 名称")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "收起 Key key-a" }));
    expect(screen.queryByLabelText("Key 名称")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "编辑模型池 pool-a" }));
    expect(screen.getByLabelText("模型池名称")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "收起模型池 pool-a" }));
    expect(screen.queryByLabelText("模型池名称")).not.toBeInTheDocument();
  });

  it("does not delete a provider when confirmation is cancelled", async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    render(<ProvidersPage configPath={null} />);
    await screen.findByText("a.example.test");

    fireEvent.click(screen.getByRole("button", { name: "删除供应商 a.example.test" }));

    expect(invokeMock).not.toHaveBeenCalledWith("delete_amkr_provider", expect.anything());
  });

  it("shows visitor permission and copies only the key fingerprint", async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    Object.assign(navigator, { clipboard });
    invokeMock.mockResolvedValue({
      ...response,
      providers: [{
        ...response.providers[0],
        keys: [{ ...response.providers[0].keys[0], allow_visitor: true }],
      }],
    });
    render(<ProvidersPage configPath={null} />);
    await screen.findByText("key-a");

    expect(screen.getByText("允许访客")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "复制 Key 指纹 key-a" }));

    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith("65bbff9a6cb9"));
    expect(await screen.findByText("指纹已复制")).toHaveClass("copy-toast");
    expect(screen.getByRole("button", { name: "复制 Key 指纹 key-a" })).toHaveTextContent("复制指纹");
  });
});
