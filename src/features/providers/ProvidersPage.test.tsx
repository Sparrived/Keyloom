import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AmkrProvidersResponse } from "../../api/amkr";
import { ProvidersPage } from "./ProvidersPage";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";

const invokeMock = vi.mocked(invoke);
const response = {
  config_revision: "revision-a",
  providers: [{
    id: "a.example.test",
    base_url: "https://a.example.test",
    keys: [{ name: "key-a", enabled: true, allow_visitor: false, api_key_fingerprint: "65bbff9a6cb9", capabilities: { models: ["model-a"], route_status: { openai: "ok" }, errors: {}, checked_at: "2026-09-01T00:00:00+00:00" } }],
    routes: { openai: "proxy/v1/chat/completions" },
  }],
};

describe("ProvidersPage", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command) => {
      if (command === "probe_amkr_key") return { config_revision: "revision-b", provider: response.providers[0] };
      return response;
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("shows only the selected provider panel", async () => {
    const multiProviderResponse = {
      ...response,
      providers: [
        response.providers[0],
        { id: "b.example.test", base_url: "https://b.example.test", keys: [], routes: {} },
      ],
    };
    invokeMock.mockImplementation(async (command) => command === "get_amkr_providers" ? multiProviderResponse : response);

    render(<ProvidersPage configPath={null} />);
    await screen.findByRole("heading", { name: "a.example.test" });

    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByRole("tab", { name: "a.example.test" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("heading", { name: "b.example.test" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "b.example.test" }));

    expect(screen.getByRole("tab", { name: "b.example.test" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "b.example.test" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "a.example.test" })).not.toBeInTheDocument();
  });

  it("opens provider creation from the first independent tab-bar button", async () => {
    let current: AmkrProvidersResponse = response;
    invokeMock.mockImplementation(async (command) => {
      if (command === "get_amkr_providers") return current;
      if (command === "create_amkr_provider") {
        current = {
          ...response,
          config_revision: "revision-b",
          providers: [
            ...response.providers,
            { id: "b.example.test", base_url: "https://b.example.test", keys: [], routes: {} },
          ],
        };
        return undefined;
      }
      return response;
    });

    render(<ProvidersPage configPath="C:/amkr.json" />);
    const addButton = await screen.findByRole("button", { name: "添加供应商" });
    const tablist = screen.getByRole("tablist", { name: "供应商列表" });

    expect(tablist.previousElementSibling).toBe(addButton);
    expect(screen.queryByRole("dialog", { name: "添加供应商" })).not.toBeInTheDocument();

    fireEvent.click(addButton);
    const dialog = screen.getByRole("dialog", { name: "添加供应商" });
    fireEvent.change(within(dialog).getByLabelText("名称"), { target: { value: "b.example.test" } });
    fireEvent.change(within(dialog).getByLabelText("地址"), { target: { value: "https://b.example.test" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "添加供应商" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("create_amkr_provider", {
      configPath: "C:/amkr.json",
      configRevision: "revision-a",
      id: "b.example.test",
      baseUrl: "https://b.example.test",
    }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "添加供应商" })).not.toBeInTheDocument());
    expect(screen.getByRole("tab", { name: "b.example.test" })).toHaveAttribute("aria-selected", "true");
  });

  it("edits a provider without rebuilding its keys", async () => {
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
    fireEvent.change(screen.getByLabelText("替换 API Key"), { target: { value: "replacement-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "保存 Key" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("update_amkr_provider_key", {
      configPath: null,
      configRevision: "revision-a",
      providerId: "a.example.test",
      keyName: "key-a",
      name: "key-a",
      apiKey: "replacement-secret",
      enabled: true,
      allowVisitor: false,
    }));

    fireEvent.click(screen.getByRole("button", { name: "删除 Key key-a" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("delete_amkr_provider_key", {
      configPath: null,
      configRevision: "revision-a",
      providerId: "a.example.test",
      keyName: "key-a",
    }));
  });

  it("adds a key, probes it synchronously and shows its capabilities", async () => {
    let current: AmkrProvidersResponse = response;
    const keyB = { name: "key-b", enabled: true, allow_visitor: false, api_key_fingerprint: "keybfingerprint", capabilities: null };
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "get_amkr_providers") return current;
      if (command === "create_amkr_provider_key") {
        current = {
          ...current,
          config_revision: "revision-b",
          providers: [{ ...current.providers[0], keys: [...current.providers[0].keys, keyB] }],
        };
        return undefined;
      }
      if (command === "probe_amkr_key") {
        current = {
          ...current,
          config_revision: "revision-c",
          providers: [{
            ...current.providers[0],
            keys: current.providers[0].keys.map((key) => key.name === "key-b" ? { ...key, capabilities: { models: ["model-b"], route_status: { openai: "ok" }, errors: {}, checked_at: "2026-09-01T00:00:00+00:00" } } : key),
          }],
        };
        return { config_revision: "revision-c", provider: current.providers[0] };
      }
      throw new Error(`unexpected command ${command} ${JSON.stringify(args)}`);
    });

    render(<ProvidersPage configPath={null} />);
    await screen.findByText("a.example.test");

    fireEvent.click(screen.getByRole("button", { name: "添加 Key" }));
    const dialog = screen.getByRole("dialog", { name: "添加 Key" });
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    fireEvent.change(screen.getByLabelText("Key 名称"), { target: { value: "key-b" } });
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "secret-b" } });
    fireEvent.click(screen.getByRole("button", { name: "添加 Key" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("probe_amkr_key", {
      configPath: null,
      configRevision: "revision-b",
      providerId: "a.example.test",
      keyName: "key-b",
    }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "添加 Key" })).not.toBeInTheDocument());
    const keyRow = await screen.findByText("key-b").then((element) => element.closest("li"));
    expect(keyRow).not.toBeNull();
    expect(within(keyRow as HTMLElement).getByText("1 个模型")).toBeInTheDocument();
    expect(within(keyRow as HTMLElement).getByText("model-b")).toBeInTheDocument();
  });

  it("adds a key and reports a probe failure without losing the key", async () => {
    let current: AmkrProvidersResponse = response;
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "get_amkr_providers") return current;
      if (command === "create_amkr_provider_key") {
        current = {
          ...current,
          config_revision: "revision-b",
          providers: [{ ...current.providers[0], keys: [...current.providers[0].keys, { name: "key-b", enabled: true, allow_visitor: false, api_key_fingerprint: "keybfingerprint", capabilities: null }] }],
        };
        return undefined;
      }
      if (command === "probe_amkr_key") throw new Error("AMKR 探测 Key 能力请求失败（HTTP 500）: 上游不可用");
      throw new Error(`unexpected command ${command} ${JSON.stringify(args)}`);
    });

    render(<ProvidersPage configPath={null} />);
    await screen.findByText("a.example.test");

    fireEvent.click(screen.getByRole("button", { name: "添加 Key" }));
    const dialog = screen.getByRole("dialog", { name: "添加 Key" });
    fireEvent.change(within(dialog).getByLabelText("Key 名称"), { target: { value: "key-b" } });
    fireEvent.change(within(dialog).getByLabelText("API Key"), { target: { value: "secret-b" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "添加 Key" }));

    expect(await within(dialog).findByText(/自动探测失败/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByText("key-b")).toBeInTheDocument();
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
    expect(screen.getByLabelText("Key 名称").closest("li")).toHaveClass("provider-row");
    fireEvent.click(screen.getByRole("button", { name: "收起 Key key-a" }));
    expect(screen.queryByLabelText("Key 名称")).not.toBeInTheDocument();
  });

  it("does not delete a provider when confirmation is cancelled", async () => {
    render(<ProvidersPage configPath={null} />);
    await screen.findByText("a.example.test");

    fireEvent.click(screen.getByRole("button", { name: "删除供应商 a.example.test" }));
    fireEvent.click(await screen.findByRole("button", { name: "取消" }));

    expect(invokeMock).not.toHaveBeenCalledWith("delete_amkr_provider", expect.anything());
  });

  it("toggles key status cards directly and removes fingerprint copying", async () => {
    render(<ProvidersPage configPath={null} />);
    await screen.findByText("key-a");

    expect(screen.getByRole("button", { name: "仅本地" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "复制 Key 指纹 key-a" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "已启用" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("update_amkr_provider_key", expect.objectContaining({ enabled: false, allowVisitor: false })));

    fireEvent.click(screen.getByRole("button", { name: "仅本地" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("update_amkr_provider_key", expect.objectContaining({ enabled: true, allowVisitor: true })));
  });

  it("probes an individual key and refreshes its capabilities", async () => {
    let probed = false;
    invokeMock.mockImplementation(async (command) => {
      if (command === "probe_amkr_key") {
        probed = true;
        return { config_revision: "revision-b", provider: response.providers[0] };
      }
      if (command === "get_amkr_providers") return { ...response, config_revision: probed ? "revision-b" : "revision-a" };
      return response;
    });
    render(<ProvidersPage configPath={null} />);
    await screen.findByText("key-a");

    fireEvent.click(screen.getByRole("button", { name: "探测 Key key-a" }));
    expect(await screen.findByText("探测成功")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "探测 Key key-a" })).toHaveTextContent("已探测");

    await waitFor(() => expect(screen.queryByText("探测成功")).not.toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByRole("button", { name: "探测 Key key-a" })).toHaveTextContent("探测");
  });
});
