import { useEffect, useState } from "react";
import {
  createAmkrPool,
  createAmkrProvider,
  createAmkrProviderKey,
  deleteAmkrPool,
  deleteAmkrProvider,
  deleteAmkrProviderKey,
  getAmkrProbe,
  getAmkrProviders,
  probeAmkrKeys,
  updateAmkrPool,
  updateAmkrProvider,
  updateAmkrProviderKey,
  type AmkrProvider,
  type AmkrProviderKey,
  type AmkrProviderPool,
  type AmkrProvidersResponse,
} from "../../api/amkr";
import { ProbePanel } from "./ProbePanel";
import type { AmkrProbeResult } from "../../api/amkr";
import { useCopyToast } from "../../components/CopyToast";

const csv = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);
const errorMessage = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);
const isConflict = (message: string) => message.includes("HTTP 409");
const probePollIntervalMs = 750;
const terminalProbeStatuses = new Set(["complete", "failed", "cancelled"]);
const providerRouteModes = [
  ["openai", "OpenAI 路径"],
  ["anthropic", "Anthropic 路径"],
  ["responses", "Responses 路径"],
  ["images", "Images 路径"],
] as const;

const normalizeModels = (models: string[]) => Array.from(new Set(models.map((model) => model.trim()).filter(Boolean))).sort();
const sameModels = (left: string[], right: string[]) => normalizeModels(left).join("\n") === normalizeModels(right).join("\n");
const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

type ProviderCardProps = {
  configPath: string | null;
  provider: AmkrProvider;
  revision: string;
  refresh: () => Promise<AmkrProvidersResponse | null>;
};

function ProviderCard({ configPath, provider, revision, refresh }: ProviderCardProps) {
  const [editingProvider, setEditingProvider] = useState(false);
  const [providerId, setProviderId] = useState(provider.id);
  const [providerUrl, setProviderUrl] = useState(provider.base_url);
  const [providerRoutes, setProviderRoutes] = useState<Record<string, string>>(provider.routes ?? {});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [keyEditName, setKeyEditName] = useState("");
  const [keyEditSecret, setKeyEditSecret] = useState("");
  const [keyEditEnabled, setKeyEditEnabled] = useState(true);
  const [keyEditVisitor, setKeyEditVisitor] = useState(false);
  const [editingPool, setEditingPool] = useState<string | null>(null);
  const [poolProbeRequest, setPoolProbeRequest] = useState<{ id: number; pool: string; key: string | null } | null>(null);
  const [poolProbeStatus, setPoolProbeStatus] = useState<string | null>(null);
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [poolEditName, setPoolEditName] = useState("");
  const [poolEditKeys, setPoolEditKeys] = useState("");
  const [poolEditModels, setPoolEditModels] = useState("");
  const [poolEditCustomModels, setPoolEditCustomModels] = useState<string[]>([]);
  const [addingCustomModel, setAddingCustomModel] = useState(false);
  const [customModelName, setCustomModelName] = useState("");
  const [addingKey, setAddingKey] = useState(false);
  const [addingPool, setAddingPool] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [keyValue, setKeyValue] = useState("");
  const [allowVisitor, setAllowVisitor] = useState(false);
  const [keyCreateBusy, setKeyCreateBusy] = useState(false);
  const [keyCreateStatus, setKeyCreateStatus] = useState<string | null>(null);
  const [poolName, setPoolName] = useState("");
  const [poolKeys, setPoolKeys] = useState("");
  const [poolModels, setPoolModels] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { copyToast, showCopyToast } = useCopyToast();

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
    setKeyEditEnabled(key.enabled);
    setKeyEditVisitor(key.allow_visitor);
  };

  const providerFrom = (data: AmkrProvidersResponse | null) => data?.providers.find((item) => item.id === provider.id) ?? null;

  const openPoolEdit = (pool: AmkrProviderPool, probeKey: string | null = pool.keys[0] ?? null) => {
    setEditingPool(pool.name);
    setPoolEditName(pool.name);
    setPoolEditKeys(pool.keys.join(", "));
    setPoolEditModels(pool.models.join(", "));
    setPoolEditCustomModels([]);
    setAddingCustomModel(false);
    setCustomModelName("");
    setDiscoveredModels([]);
    setPoolProbeStatus(probeKey ? "pending" : null);
    setPoolProbeRequest((value) => ({
      id: (value?.id ?? 0) + 1,
      pool: pool.name,
      key: probeKey,
    }));
  };

  const beginPoolEdit = (pool: AmkrProviderPool) => {
    if (editingPool === pool.name) {
      setEditingPool(null);
      setPoolProbeStatus(null);
      return;
    }
    openPoolEdit(pool);
  };

  const uniquePoolName = (models: string[], fallback: string, pools: AmkrProviderPool[]) => {
    const base = models[0] || fallback;
    const used = new Set(pools.map((pool) => pool.name));
    if (!used.has(base)) return base;
    for (let index = 2; ; index += 1) {
      const name = `${base}-${index}`;
      if (!used.has(name)) return name;
    }
  };

  const probeKeyModels = async (name: string) => {
    const started = await probeAmkrKeys(provider.id, [name], 15, configPath);
    for (let attempt = 0; attempt < 160; attempt += 1) {
      const probe = await getAmkrProbe(started.probe_id, configPath);
      if (terminalProbeStatuses.has(probe.status)) {
        if (probe.status !== "complete") throw new Error(probe.error || "Key 探测未完成。");
        return normalizeModels(probe.results.filter((result) => result.key === name).flatMap((result) => result.models));
      }
      await wait(probePollIntervalMs);
    }
    throw new Error("Key 探测超时。");
  };

  const createKeyAndAssignPool = async () => {
    if (keyCreateBusy) return;
    const name = keyName.trim();
    if (!name || !keyValue) return;
    setKeyCreateBusy(true);
    setKeyCreateStatus("正在保存 Key…");
    try {
      let data = await mutate(() => createAmkrProviderKey(revision, provider.id, name, keyValue, allowVisitor, configPath));
      if (!data) return;
      setKeyValue("");
      setKeyCreateStatus("正在探测可用模型…");
      const models = await probeKeyModels(name);
      let currentProvider = providerFrom(data);
      if (!currentProvider) return;
      const pool = models.length ? currentProvider.pools.find((item) => sameModels(item.models, models)) : null;
      const configRevision = data.config_revision;
      const currentPools = currentProvider.pools;
      setKeyCreateStatus(pool ? "正在加入匹配的模型池…" : "正在创建匹配的模型池…");
      data = pool
        ? await mutate(() => updateAmkrPool(configRevision, provider.id, pool.name, pool.name, Array.from(new Set([...pool.keys, name])), pool.models, configPath))
        : await mutate(() => createAmkrPool(configRevision, provider.id, uniquePoolName(models, name, currentPools), [name], models, configPath));
      if (!data) return;
      currentProvider = providerFrom(data);
      const editedPool = pool
        ? currentProvider?.pools.find((item) => item.name === pool.name)
        : currentProvider?.pools.find((item) => sameModels(item.models, models) && item.keys.includes(name));
      setKeyName("");
      setAllowVisitor(false);
      setAddingKey(false);
      setKeyCreateStatus(null);
      if (editedPool) openPoolEdit(editedPool, null);
    } catch (reason) {
      setError(`Key 已保存，但自动探测和分池失败: ${errorMessage(reason)}`);
    } finally {
      setKeyCreateStatus(null);
      setKeyCreateBusy(false);
    }
  };

  const togglePoolModel = (model: string) => {
    setPoolEditModels((current) => {
      const selected = csv(current);
      if (selected.includes(model)) return selected.filter((item) => item !== model).join(", ");
      return Array.from(new Set([...selected, model])).join(", ");
    });
  };

  const removeSelectedModel = (model: string) => {
    setPoolEditModels((current) => csv(current).filter((item) => item !== model).join(", "));
  };

  const addCustomPoolModel = () => {
    const model = customModelName.trim();
    if (!model) return;
    setPoolEditCustomModels((current) => Array.from(new Set([...current, model])));
    setPoolEditModels((current) => Array.from(new Set([...csv(current), model])).join(", "));
    setCustomModelName("");
    setAddingCustomModel(false);
  };

  const deleteCustomPoolModel = (model: string) => {
    setPoolEditCustomModels((current) => current.filter((item) => item !== model));
    removeSelectedModel(model);
  };

  const handlePoolProbeResults = (results: AmkrProbeResult[]) => {
    const models = Array.from(new Set(results.flatMap((result) => result.models))).sort();
    setDiscoveredModels(models);
    setPoolEditModels((current) => csv(current).length ? current : models.join(", "));
  };

  const selectedPoolModels = csv(poolEditModels);
  const poolModelCards = Array.from(new Set([...selectedPoolModels, ...discoveredModels, ...poolEditCustomModels])).filter(Boolean);
  const poolProbeBusy = poolProbeStatus === "pending" || poolProbeStatus === "running";

  const copyFingerprint = async (key: AmkrProviderKey) => {
    if (!navigator.clipboard?.writeText) {
      setError("当前环境不支持复制指纹。");
      return;
    }
    try {
      await navigator.clipboard.writeText(key.api_key_fingerprint);
      showCopyToast("指纹已复制");
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  return <article className="provider-item">
    <header className="provider-summary">
      <div className="provider-identity"><h3>{provider.id}</h3><p>{provider.base_url}</p><span>{provider.keys.length} 个 Key · {provider.pools.length} 个模型池</span></div>
      <div className="item-actions">
        <button aria-expanded={editingProvider} aria-label={`${editingProvider ? "收起" : "编辑"}供应商 ${provider.id}`} className="secondary-button" type="button" onClick={() => { if (editingProvider) { setEditingProvider(false); return; } setProviderId(provider.id); setProviderUrl(provider.base_url); setProviderRoutes(provider.routes ?? {}); setEditingProvider(true); }}>{editingProvider ? "收起" : "编辑"}</button>
        <button aria-label={`删除供应商 ${provider.id}`} className="danger-button" type="button" onClick={() => { if (window.confirm(`删除供应商 ${provider.id} 及其 Key 和模型池？`)) void mutate(() => deleteAmkrProvider(revision, provider.id, configPath)); }}>删除</button>
      </div>
    </header>

    {editingProvider ? <form className="inline-form editor-form provider-editor" onSubmit={(event) => { event.preventDefault(); void (async () => { if (await mutate(() => updateAmkrProvider(revision, provider.id, providerId, providerUrl, Object.fromEntries(Object.entries(providerRoutes).filter(([, value]) => value.trim()).map(([mode, value]) => [mode, value.trim()])), configPath))) setEditingProvider(false); })(); }}>
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
        {provider.keys.length ? <ul>{provider.keys.map((key) => <li className="provider-row" key={key.name}>
          <div className="provider-row-main"><strong>{key.name}</strong><code>{key.api_key_fingerprint}</code></div>
          <div className="provider-statuses"><span className={key.enabled ? "status-good" : "status-muted"}>{key.enabled ? "已启用" : "已停用"}</span><span className={key.allow_visitor ? "status-good" : "status-muted"}>{key.allow_visitor ? "允许访客" : "仅本地"}</span></div>
          <div className="row-actions">
            <button aria-label={`复制 Key 指纹 ${key.name}`} className="secondary-button" type="button" onClick={() => void copyFingerprint(key)}>复制指纹</button>
            <button aria-expanded={editingKey === key.name} aria-label={`${editingKey === key.name ? "收起" : "编辑"} Key ${key.name}`} className="secondary-button" type="button" onClick={() => beginKeyEdit(key)}>{editingKey === key.name ? "收起" : "编辑"}</button>
            <button aria-label={`删除 Key ${key.name}`} className="danger-button" type="button" onClick={() => { if (window.confirm(`删除 Key ${key.name}？`)) void mutate(() => deleteAmkrProviderKey(revision, provider.id, key.name, configPath)); }}>删除</button>
          </div>
        </li>)}</ul> : <p>尚无 Key。</p>}
        {editingKey ? <form className="inline-form editor-form resource-form" onSubmit={(event) => { event.preventDefault(); void (async () => { if (await mutate(() => updateAmkrProviderKey(revision, provider.id, editingKey, keyEditName, keyEditSecret.trim() || null, keyEditEnabled, keyEditVisitor, configPath))) setEditingKey(null); })(); }}>
          <label>Key 名称<input required value={keyEditName} onChange={(event) => setKeyEditName(event.target.value)} /></label>
          <label>替换 API Key<input type="password" value={keyEditSecret} onChange={(event) => setKeyEditSecret(event.target.value)} /></label>
          <label className="checkbox-label"><input aria-label="启用 Key" checked={keyEditEnabled} type="checkbox" onChange={(event) => setKeyEditEnabled(event.target.checked)} />启用</label>
          <label className="checkbox-label"><input aria-label="允许访客" checked={keyEditVisitor} type="checkbox" onChange={(event) => setKeyEditVisitor(event.target.checked)} />访客访问</label>
          <div className="form-actions"><button type="submit">保存 Key</button><button className="secondary-button" type="button" onClick={() => setEditingKey(null)}>取消</button></div>
        </form> : null}
        {addingKey ? <form className="inline-form resource-form create-resource-form" onSubmit={(event) => { event.preventDefault(); void createKeyAndAssignPool(); }}>
          <label>Key 名称<input disabled={keyCreateBusy} required value={keyName} onChange={(event) => setKeyName(event.target.value)} /></label>
          <label>API Key<input disabled={keyCreateBusy} required type="password" value={keyValue} onChange={(event) => setKeyValue(event.target.value)} /></label>
          <label className="checkbox-label"><input checked={allowVisitor} disabled={keyCreateBusy} type="checkbox" onChange={(event) => setAllowVisitor(event.target.checked)} />访客访问</label>
          <p className="editor-help">{keyCreateStatus ?? "保存后会自动探测模型，并把可用模型相同的 Key 放进同一个模型池。"}</p>
          <div className="form-actions"><button disabled={keyCreateBusy} type="submit">{keyCreateBusy ? "正在添加" : "添加 Key"}</button></div>
        </form> : null}
      </section>

      <section className="provider-resource" aria-label={`${provider.id} 的模型池`}>
        <div className="provider-section-heading"><div><h4>模型池</h4><p>将 Key 与可用模型组合为路由目标</p></div><button className="secondary-button" type="button" onClick={() => setAddingPool((value) => !value)}>{addingPool ? "取消添加" : "添加模型池"}</button></div>
        {provider.pools.length ? <ul>{provider.pools.map((pool) => <li className="provider-row" key={pool.name}>
          <div className="provider-row-main"><strong>{pool.name}</strong><span>{pool.models.join(", ") || "未绑定模型"}</span></div>
          <div className="row-actions">
            <button aria-expanded={editingPool === pool.name} aria-label={`${editingPool === pool.name ? "收起" : "编辑"}模型池 ${pool.name}`} className="secondary-button" type="button" onClick={() => beginPoolEdit(pool)}>{editingPool === pool.name ? "收起" : "编辑"}</button>
            <button aria-label={`删除模型池 ${pool.name}`} className="danger-button" type="button" onClick={() => { if (window.confirm(`删除模型池 ${pool.name}？`)) void mutate(() => deleteAmkrPool(revision, provider.id, pool.name, configPath)); }}>删除</button>
          </div>
        </li>)}</ul> : <p>尚无模型池。</p>}
        {editingPool ? <form className="inline-form editor-form resource-form" onSubmit={(event) => { event.preventDefault(); void (async () => { if (await mutate(() => updateAmkrPool(revision, provider.id, editingPool, poolEditName, csv(poolEditKeys), selectedPoolModels, configPath))) setEditingPool(null); })(); }}>
          <label>模型池名称<input required value={poolEditName} onChange={(event) => setPoolEditName(event.target.value)} /></label>
          <label>模型池 Key<input value={poolEditKeys} onChange={(event) => setPoolEditKeys(event.target.value)} /></label>
          <div aria-label="模型池模型" className="pool-model-grid">
            {poolProbeBusy ? <div aria-label="正在探测模型" className="pool-model-probe-indicator" role="status"><span /></div> : null}
            {poolModelCards.map((model) => {
              const selected = selectedPoolModels.includes(model);
              const custom = poolEditCustomModels.includes(model);
              return <div className="pool-model-card-shell" key={model}>
                <button aria-label={`${selected ? "关闭" : "打开"}模型 ${model}`} aria-pressed={selected} className={`pool-model-card${selected ? " is-selected" : ""}`} type="button" onClick={() => togglePoolModel(model)}>{model}</button>
                {custom ? <button aria-label={`删除自定义模型 ${model}`} className="pool-model-remove" type="button" onClick={() => deleteCustomPoolModel(model)}>×</button> : null}
              </div>;
            })}
            {addingCustomModel ? <div className="pool-model-card custom-model-card">
              <input aria-label="自定义模型名称" autoFocus value={customModelName} onChange={(event) => setCustomModelName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addCustomPoolModel(); } else if (event.key === "Escape") { setAddingCustomModel(false); setCustomModelName(""); } }} />
              <button aria-label="确认添加自定义模型" type="button" onClick={() => addCustomPoolModel()}>+</button>
            </div> : <button aria-label="添加自定义模型" className="pool-model-card pool-model-add" type="button" onClick={() => setAddingCustomModel(true)}>+</button>}
          </div>
          <div className="form-actions"><button type="submit">保存模型池</button><button className="secondary-button" type="button" onClick={() => setEditingPool(null)}>取消</button></div>
        </form> : null}
        {addingPool ? <form className="inline-form resource-form create-resource-form" onSubmit={(event) => { event.preventDefault(); void (async () => { if (await mutate(() => createAmkrPool(revision, provider.id, poolName, csv(poolKeys), csv(poolModels), configPath))) { setPoolName(""); setPoolKeys(""); setPoolModels(""); setAddingPool(false); } })(); }}>
          <label>名称<input required value={poolName} onChange={(event) => setPoolName(event.target.value)} /></label>
          <label>Key<input value={poolKeys} onChange={(event) => setPoolKeys(event.target.value)} placeholder="逗号分隔" /></label>
          <label>模型<input value={poolModels} onChange={(event) => setPoolModels(event.target.value)} placeholder="逗号分隔" /></label>
          <div className="form-actions"><button type="submit">添加模型池</button></div>
        </form> : null}
      </section>
    </div>
    <ProbePanel configPath={configPath} providerId={provider.id} keys={provider.keys.map((key) => key.name)} pools={provider.pools.map((pool) => pool.name)} onPoolProbeResults={handlePoolProbeResults} onPoolProbeStatus={setPoolProbeStatus} poolProbeRequest={poolProbeRequest} />
    {error ? <p className="service-action-error">操作失败: {error}</p> : null}
    {copyToast}
  </article>;
}

export function ProvidersPage({ configPath }: { configPath: string | null }) {
  const [data, setData] = useState<AmkrProvidersResponse | null>(null);
  const [id, setId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const next = await getAmkrProviders(configPath);
      setData(next);
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

  return <section className="providers-page" aria-labelledby="providers-heading">
    <header className="page-header"><div><h2 id="providers-heading">供应商</h2><p>管理本机 AMKR 的上游连接、Key 与模型池。</p></div>{data ? <span className="config-revision">版本 {data.config_revision.slice(0, 12)}</span> : null}</header>
    <section className="provider-create-panel" aria-labelledby="provider-create-heading">
      <div><h3 id="provider-create-heading">添加供应商</h3><p>连接一个兼容 OpenAI 或 Anthropic 协议的上游服务。</p></div>
      <form className="provider-create" onSubmit={(event) => { event.preventDefault(); if (!data) return; void (async () => { try { await createAmkrProvider(data.config_revision, id, baseUrl, configPath); setId(""); setBaseUrl(""); await refresh(); } catch (reason) { const message = errorMessage(reason); if (isConflict(message)) await refresh(); setError(message); } })(); }}>
        <label>名称<input required value={id} onChange={(event) => setId(event.target.value)} placeholder="例如 openai" /></label>
        <label>地址<input required type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com" /></label>
        <button type="submit" disabled={!data || loading}>添加</button>
      </form>
    </section>
    {loading ? <p className="empty-state">正在读取供应商配置。</p> : null}
    {error ? <p className="service-action-error">无法读取或写入供应商配置: {error}</p> : null}
    {data?.providers.length === 0 ? <p className="empty-state">尚未配置供应商。</p> : null}
    <div className="provider-list">{data?.providers.map((provider) => <ProviderCard configPath={configPath} key={provider.id} provider={provider} refresh={refresh} revision={data.config_revision} />)}</div>
  </section>;
}
