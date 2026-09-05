import { useEffect, useState } from "react";
import {
  createAmkrProvider,
  createAmkrProviderKey,
  deleteAmkrProvider,
  deleteAmkrProviderKey,
  getAmkrProviders,
  probeAmkrKey,
  updateAmkrProvider,
  updateAmkrProviderKey,
  type AmkrProvider,
  type AmkrProviderKey,
  type AmkrProvidersResponse,
} from "../../api/amkr";
import { ProbePanel } from "./ProbePanel";
import { useCopyToast } from "../../components/CopyToast";
import { useConfirmDialog } from "../../components/ConfirmDialog";
import { GlobalPortal } from "../../components/GlobalPortal";

const errorMessage = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);
const isConflict = (message: string) => message.includes("HTTP 409");
const providerRouteModes = [
  ["openai", "OpenAI 路径"],
  ["anthropic", "Anthropic 路径"],
  ["responses", "Responses 路径"],
  ["images", "Images 路径"],
] as const;

type KeyProbeState = "idle" | "pending" | "success" | "error";

const normalizeModels = (models: string[]) => Array.from(new Set(models.map((model) => model.trim()).filter(Boolean))).sort();
const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

type ProviderCardProps = {
  configPath: string | null;
  provider: AmkrProvider;
  revision: string;
  refresh: () => Promise<AmkrProvidersResponse | null>;
  onProviderIdChange?: (providerId: string) => void;
};

function ProviderCard({ configPath, provider, revision, refresh, onProviderIdChange }: ProviderCardProps) {
  const [editingProvider, setEditingProvider] = useState(false);
  const [providerId, setProviderId] = useState(provider.id);
  const [providerUrl, setProviderUrl] = useState(provider.base_url);
  const [providerRoutes, setProviderRoutes] = useState<Record<string, string>>(provider.routes ?? {});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [keyEditName, setKeyEditName] = useState("");
  const [keyEditSecret, setKeyEditSecret] = useState("");
  const [addingKey, setAddingKey] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [keyValue, setKeyValue] = useState("");
  const [allowVisitor, setAllowVisitor] = useState(false);
  const [keyCreateBusy, setKeyCreateBusy] = useState(false);
  const [keyCreateStep, setKeyCreateStep] = useState<"idle" | "saving" | "probing" | "complete" | "error">("idle");
  const [keyProbeStates, setKeyProbeStates] = useState<Record<string, KeyProbeState>>({});
  const [error, setError] = useState<string | null>(null);
  const { copyToast, showCopyToast } = useCopyToast();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const mutate = async (operation: () => Promise<unknown>, successMessage = "配置已更新。") => {
    setError(null);
    try {
      await operation();
      const result = await refresh();
      showCopyToast(successMessage);
      return result;
    } catch (reason) {
      const message = errorMessage(reason);
      if (isConflict(message)) await refresh();
      setError(message);
      return null;
    }
  };

  const beginKeyEdit = (key: AmkrProviderKey) => {
    if (editingKey === key.name) {
      setEditingKey(null);
      return;
    }
    setEditingKey(key.name);
    setKeyEditName(key.name);
    setKeyEditSecret("");
  };

  const probeKey = async (name: string) => {
    if (keyProbeStates[name] === "pending") return;
    setKeyProbeStates((current) => ({ ...current, [name]: "pending" }));
    setError(null);
    try {
      const result = await probeAmkrKey(revision, provider.id, name, configPath);
      const refreshed = await refresh();
      const key = refreshed?.providers.find((item) => item.id === provider.id)?.keys.find((item) => item.name === name)
        ?? result.provider.keys.find((item) => item.name === name);
      setKeyProbeStates((current) => ({ ...current, [name]: "success" }));
      window.setTimeout(() => setKeyProbeStates((current) => current[name] === "success" ? { ...current, [name]: "idle" } : current), 2400);
      const models = normalizeModels(key?.capabilities?.models ?? []);
      showCopyToast(models.length ? `Key ${name} 探测成功，发现 ${models.length} 个模型。` : `Key ${name} 探测完成（未发现模型）。`);
    } catch (reason) {
      setKeyProbeStates((current) => ({ ...current, [name]: "error" }));
      setError(`Key ${name} 探测失败: ${errorMessage(reason)}`);
    }
  };

  const createKeyAndProbe = async () => {
    if (keyCreateBusy) return;
    const name = keyName.trim();
    if (!name || !keyValue) return;
    setKeyCreateBusy(true);
    setError(null);
    setKeyCreateStep("saving");
    try {
      const data = await mutate(() => createAmkrProviderKey(revision, provider.id, name, keyValue, allowVisitor, configPath));
      if (!data) throw new Error("Key 保存失败。");
      setKeyValue("");
      setKeyCreateStep("probing");
      await probeAmkrKey(data.config_revision, provider.id, name, configPath);
      await refresh();
      setKeyName("");
      setAllowVisitor(false);
      setKeyCreateStep("complete");
      await wait(450);
      setAddingKey(false);
      setKeyCreateStep("idle");
    } catch (reason) {
      setKeyCreateStep("error");
      setError(`Key 已保存，但自动探测失败: ${errorMessage(reason)}`);
    } finally {
      setKeyCreateBusy(false);
    }
  };

  const keyCreateStatus = keyCreateStep === "saving"
    ? "正在保存 Key"
    : keyCreateStep === "probing"
      ? "正在探测可用模型"
      : keyCreateStep === "complete"
        ? "探测完成"
        : null;
  const closeKeyDialog = () => {
    if (keyCreateBusy) return;
    setAddingKey(false);
    setKeyCreateStep("idle");
  };

  const toggleKeySetting = (key: AmkrProviderKey, setting: "enabled" | "allowVisitor") => {
    void mutate(() => updateAmkrProviderKey(
      revision,
      provider.id,
      key.name,
      key.name,
      null,
      setting === "enabled" ? !key.enabled : key.enabled,
      setting === "allowVisitor" ? !key.allow_visitor : key.allow_visitor,
      configPath,
    ));
  };

  const removeProvider = async () => {
    if (await confirm(`删除供应商 ${provider.id} 及其全部 Key？`)) void mutate(() => deleteAmkrProvider(revision, provider.id, configPath));
  };

  const removeKey = async (name: string) => {
    if (await confirm(`删除 Key ${name}？`)) void mutate(() => deleteAmkrProviderKey(revision, provider.id, name, configPath));
  };

  return <article aria-label={`${provider.id} 供应商配置`} className="provider-item">
    <header className="provider-summary">
      <div className="provider-identity"><h3>{provider.id}</h3><p>{provider.base_url}</p><span>{provider.keys.length} 个 Key · {provider.keys.filter((key) => key.capabilities?.models?.length).length} 个已探测</span></div>
      <div className="item-actions">
        <button aria-expanded={editingProvider} aria-label={`${editingProvider ? "收起" : "编辑"}供应商 ${provider.id}`} className="secondary-button" type="button" onClick={() => { if (editingProvider) { setEditingProvider(false); return; } setProviderId(provider.id); setProviderUrl(provider.base_url); setProviderRoutes(provider.routes ?? {}); setEditingProvider(true); }}>{editingProvider ? "收起" : "编辑"}</button>
        <button aria-label={`删除供应商 ${provider.id}`} className="danger-button" type="button" onClick={() => void removeProvider()}>删除</button>
      </div>
    </header>

    {editingProvider ? <form className="inline-form editor-form provider-editor" onSubmit={(event) => { event.preventDefault(); void (async () => { if (await mutate(() => updateAmkrProvider(revision, provider.id, providerId, providerUrl, Object.fromEntries(Object.entries(providerRoutes).filter(([, value]) => value.trim()).map(([mode, value]) => [mode, value.trim()])), configPath))) { onProviderIdChange?.(providerId.trim()); setEditingProvider(false); } })(); }}>
      <label>供应商名称<input required value={providerId} onChange={(event) => setProviderId(event.target.value)} /></label>
      <label>供应商地址<input required type="url" value={providerUrl} onChange={(event) => setProviderUrl(event.target.value)} /></label>
      <details className="provider-advanced-settings">
        <summary>高级路径设置</summary>
        <div className="provider-route-fields">{providerRouteModes.map(([mode, label]) => <label key={mode}>{label}<input value={providerRoutes[mode] ?? ""} onChange={(event) => setProviderRoutes({ ...providerRoutes, [mode]: event.target.value })} placeholder="留空使用默认路径" /></label>)}</div>
      </details>
      <div className="form-actions"><button type="submit">保存供应商</button><button className="secondary-button" type="button" onClick={() => setEditingProvider(false)}>取消</button></div>
    </form> : null}

    <div className="provider-details">
      <section className="provider-resource" aria-label={`${provider.id} 的 Key`}>
        <div className="provider-section-heading"><div><h4>Key</h4><p>用于连接此供应商的凭据</p></div><button className="secondary-button" type="button" onClick={() => setAddingKey((value) => !value)}>{addingKey ? "取消添加" : "添加 Key"}</button></div>
        {provider.keys.length ? <ul>{provider.keys.map((key) => {
          const capabilities = key.capabilities;
          const modelList = normalizeModels(capabilities?.models ?? []);
          const routeErrors = Object.entries(capabilities?.errors ?? {}).filter(([, message]) => message);
          return <li className="provider-row" key={key.name}>
          <div className={`provider-row-main${keyProbeStates[key.name] === "success" ? " key-probe-success" : ""}`}>
            <strong>{key.name}</strong><code>{key.api_key_fingerprint}</code>
            {keyProbeStates[key.name] === "success" ? <span className="key-probe-feedback" role="status">探测成功</span> : null}
            {keyProbeStates[key.name] === "error" ? <span className="key-probe-feedback key-probe-error" role="status">探测失败</span> : null}
            {capabilities ? <span className={`key-capabilities-badge ${modelList.length ? "status-good" : routeErrors.length ? "status-warn" : "status-muted"}`}>{modelList.length ? `${modelList.length} 个模型` : routeErrors.length ? "探测有错误" : "未发现模型"}</span> : <span className="key-capabilities-badge status-muted">未探测</span>}
            {modelList.length ? <span className="key-capability-models">{modelList.join(", ")}</span> : null}
            {routeErrors.length ? <span className="key-capability-errors">{routeErrors.map(([mode, message]) => `${mode}: ${message}`).join(" · ")}</span> : null}
          </div>
          <div className="provider-statuses">
            <button aria-pressed={key.enabled} className={`key-status-button ${key.enabled ? "status-good" : "status-muted"}`} type="button" onClick={() => toggleKeySetting(key, "enabled")}>{key.enabled ? "已启用" : "已停用"}</button>
            <button aria-pressed={key.allow_visitor} className={`key-status-button ${key.allow_visitor ? "status-good" : "status-muted"}`} type="button" onClick={() => toggleKeySetting(key, "allowVisitor")}>{key.allow_visitor ? "允许访客" : "仅本地"}</button>
          </div>
          <div className="row-actions">
            <button aria-label={`探测 Key ${key.name}`} className={`secondary-button key-probe-button${keyProbeStates[key.name] === "success" ? " is-success" : ""}`} disabled={keyProbeStates[key.name] === "pending" || keyProbeStates[key.name] === "success"} type="button" onClick={() => void probeKey(key.name)}>{keyProbeStates[key.name] === "pending" ? "探测中" : keyProbeStates[key.name] === "success" ? "已探测" : "探测"}</button>
            <button aria-expanded={editingKey === key.name} aria-label={`${editingKey === key.name ? "收起" : "编辑"} Key ${key.name}`} className="secondary-button" type="button" onClick={() => beginKeyEdit(key)}>{editingKey === key.name ? "收起" : "编辑"}</button>
            <button aria-label={`删除 Key ${key.name}`} className="danger-button" type="button" onClick={() => void removeKey(key.name)}>删除</button>
          </div>
          {editingKey === key.name ? <form className="inline-form editor-form resource-form" onSubmit={(event) => { event.preventDefault(); void (async () => { if (await mutate(() => updateAmkrProviderKey(revision, provider.id, editingKey, keyEditName, keyEditSecret.trim() || null, key.enabled, key.allow_visitor, configPath))) setEditingKey(null); })(); }}>
            <label>Key 名称<input required value={keyEditName} onChange={(event) => setKeyEditName(event.target.value)} /></label>
            <label>替换 API Key<input type="password" value={keyEditSecret} onChange={(event) => setKeyEditSecret(event.target.value)} /></label>
            <div className="form-actions"><button type="submit">保存 Key</button><button className="secondary-button" type="button" onClick={() => setEditingKey(null)}>取消</button></div>
          </form> : null}
        </li>;
        })}</ul> : <p>尚无 Key。</p>}
      </section>
    </div>
    <ProbePanel configPath={configPath} providerId={provider.id} keys={provider.keys.map((key) => key.name)} />
    {error ? <p className="service-action-error">操作失败: {error}</p> : null}
    {addingKey ? <GlobalPortal><div className="close-dialog-backdrop key-create-backdrop" onKeyDown={(event) => { if (event.key === "Escape") closeKeyDialog(); }}>
      <section aria-labelledby="key-create-dialog-heading" aria-modal="true" className="close-dialog key-create-dialog" role="dialog">
        <div className="key-create-dialog-heading"><div><span className="eyebrow">供应商 / {provider.id}</span><h2 id="key-create-dialog-heading">添加 Key</h2></div><span className={`key-create-orbit key-create-orbit-${keyCreateStep}`} aria-hidden="true" /></div>
        {keyCreateStep === "idle" || keyCreateStep === "error" ? <form className="key-create-form" onSubmit={(event) => { event.preventDefault(); void createKeyAndProbe(); }}>
          <label>Key 名称<input autoFocus disabled={keyCreateBusy} required value={keyName} onChange={(event) => setKeyName(event.target.value)} /></label>
          <label>API Key<input disabled={keyCreateBusy} required type="password" value={keyValue} onChange={(event) => setKeyValue(event.target.value)} /></label>
          <label className="checkbox-label"><input checked={allowVisitor} disabled={keyCreateBusy} type="checkbox" onChange={(event) => setAllowVisitor(event.target.checked)} />访客访问</label>
          <p className="editor-help">保存后会自动探测此 Key 的可用模型与路由能力。</p>
          {keyCreateStep === "error" ? <p className="service-action-error" role="alert">{error}</p> : null}
          <div className="close-dialog-actions"><button className="secondary-button" type="button" onClick={closeKeyDialog}>取消</button><button className="tray-action" type="submit">添加 Key</button></div>
        </form> : <div className="key-create-progress" aria-live="polite">
          <p className="key-create-progress-title">{keyCreateStatus}</p>
          <ol className="key-create-steps">
            {[["saving", "保存 Key"], ["probing", "探测可用模型"], ["complete", "完成"]].map(([step, label]) => <li className={keyCreateStep === step ? "is-active" : (["saving", "probing", "complete"].indexOf(keyCreateStep) > ["saving", "probing"].indexOf(step) ? "is-done" : "")} key={step}><span aria-hidden="true">{["saving", "probing", "complete"].indexOf(keyCreateStep) > ["saving", "probing"].indexOf(step) ? "✓" : ""}</span>{label}</li>)}
          </ol>
        </div>}
      </section>
    </div></GlobalPortal> : null}
    {confirmDialog}
    {copyToast}
  </article>;
}

export function ProvidersPage({ configPath }: { configPath: string | null }) {
  const [data, setData] = useState<AmkrProvidersResponse | null>(null);
  const [id, setId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [providerCreateError, setProviderCreateError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creatingProvider, setCreatingProvider] = useState(false);
  const [providerCreateOpen, setProviderCreateOpen] = useState(false);
  const [activeProviderId, setActiveProviderId] = useState("");

  const refresh = async () => {
    setLoading(true);
    try {
      const next = await getAmkrProviders(configPath);
      setData(next);
      setActiveProviderId((current) => next.providers.some((provider) => provider.id === current) ? current : next.providers[0]?.id ?? "");
      setError(null);
      return next;
    }
    catch (reason) {
      setError(errorMessage(reason));
      return null;
    }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, [configPath]);

  const closeProviderCreateDialog = () => {
    if (creatingProvider) return;
    setProviderCreateOpen(false);
    setProviderCreateError(null);
    setId("");
    setBaseUrl("");
  };

  const submitProvider = async () => {
    if (!data || creatingProvider) return;
    const providerId = id.trim();
    const providerUrl = baseUrl.trim();
    if (!providerId || !providerUrl) return;
    setCreatingProvider(true);
    setProviderCreateError(null);
    setError(null);
    try {
      await createAmkrProvider(data.config_revision, providerId, providerUrl, configPath);
      setId("");
      setBaseUrl("");
      await refresh();
      setActiveProviderId(providerId);
      setProviderCreateOpen(false);
    } catch (reason) {
      const message = errorMessage(reason);
      if (isConflict(message)) await refresh();
      setProviderCreateError(message);
    } finally {
      setCreatingProvider(false);
    }
  };

  return <section className="providers-page" aria-labelledby="providers-heading">
    <header className="page-header"><div><h2 id="providers-heading">供应商</h2><p>管理本机 AMKR 的上游连接、Key 与可用模型。</p></div>{data ? <span className="config-revision">版本 {data.config_revision.slice(0, 12)}</span> : null}</header>
    {loading ? <p className="empty-state">正在读取供应商配置。</p> : null}
    {error ? <p className="service-action-error">无法读取或写入供应商配置: {error}</p> : null}
    {data ? <div className="configuration-tabs">
      <div className="configuration-tabbar">
        <button aria-controls="provider-create-dialog" aria-expanded={providerCreateOpen} aria-haspopup="dialog" className="provider-add-button" disabled={loading} type="button" onClick={() => { setProviderCreateError(null); setProviderCreateOpen(true); }}>添加供应商</button>
        {data.providers.length ? <div aria-label="供应商列表" className="configuration-tablist" role="tablist">
          {data.providers.map((provider) => {
          const selected = provider.id === activeProviderId;
          return <button
            aria-controls={`provider-panel-${encodeURIComponent(provider.id)}`}
            aria-selected={selected}
            className="configuration-tab"
            id={`provider-tab-${encodeURIComponent(provider.id)}`}
            key={provider.id}
            role="tab"
            tabIndex={selected ? 0 : -1}
            type="button"
            aria-label={provider.id}
            onClick={() => setActiveProviderId(provider.id)}
            onKeyDown={(event) => {
              const index = data.providers.findIndex((item) => item.id === provider.id);
              const nextIndex = event.key === "ArrowRight" ? (index + 1) % data.providers.length : event.key === "ArrowLeft" ? (index - 1 + data.providers.length) % data.providers.length : -1;
              if (nextIndex < 0) return;
              event.preventDefault();
              setActiveProviderId(data.providers[nextIndex].id);
              window.setTimeout(() => document.getElementById(`provider-tab-${encodeURIComponent(data.providers[nextIndex].id)}`)?.focus(), 0);
            }}
            ><strong>供应商 · {provider.id}</strong><span>{provider.keys.length} Key · {provider.keys.filter((key) => key.capabilities?.models?.length).length} 已探测</span></button>;
          })}
        </div> : null}
      </div>
      {data.providers.length === 0 ? <p className="empty-state provider-empty-state">尚未配置供应商。</p> : null}
      {data.providers.map((provider) => provider.id === activeProviderId ? <div
        aria-labelledby={`provider-tab-${encodeURIComponent(provider.id)}`}
        className="configuration-tabpanel"
        id={`provider-panel-${encodeURIComponent(provider.id)}`}
        key={provider.id}
        role="tabpanel"
        tabIndex={0}
      ><ProviderCard configPath={configPath} provider={provider} refresh={refresh} revision={data.config_revision} onProviderIdChange={setActiveProviderId} /></div> : null)}
    </div> : null}
    {providerCreateOpen ? <GlobalPortal><div className="close-dialog-backdrop provider-create-backdrop" onKeyDown={(event) => { if (event.key === "Escape") closeProviderCreateDialog(); }}>
      <section aria-labelledby="provider-create-dialog-heading" aria-modal="true" className="close-dialog provider-create-dialog" id="provider-create-dialog" role="dialog">
        <div className="provider-create-dialog-heading"><div><span className="eyebrow">供应商</span><h2 id="provider-create-dialog-heading">添加供应商</h2></div><button className="provider-create-dialog-close" disabled={creatingProvider} type="button" onClick={closeProviderCreateDialog}>关闭</button></div>
        <p>连接一个兼容 OpenAI 或 Anthropic 协议的上游服务。</p>
        <form className="provider-create" onSubmit={(event) => { event.preventDefault(); void submitProvider(); }}>
          <label>名称<input autoFocus disabled={creatingProvider} required value={id} onChange={(event) => setId(event.target.value)} placeholder="例如 openai" /></label>
          <label>地址<input disabled={creatingProvider} required type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com" /></label>
          {providerCreateError ? <p className="service-action-error" role="alert">添加失败: {providerCreateError}</p> : null}
          <div className="close-dialog-actions"><button className="secondary-button" disabled={creatingProvider} type="button" onClick={closeProviderCreateDialog}>取消</button><button className="tray-action" disabled={!data || creatingProvider} type="submit">{creatingProvider ? "添加中" : "添加供应商"}</button></div>
        </form>
      </section>
    </div></GlobalPortal> : null}
  </section>;
}
