import { useEffect, useState } from "react";
import { createAmkrRoute, deleteAmkrRoute, getAmkrRoutes, updateAmkrRoute, type AmkrRoute, type AmkrRouteTarget, type AmkrRoutesResponse, type AmkrUnifiedModel } from "../../api/amkr";
import { UnifiedModelPanel } from "./UnifiedModelPanel";

const csv = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);
const errorMessage = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);
const isConflict = (message: string) => message.includes("HTTP 409");

type RouteDraft = {
  originalId: string;
  id: string;
  targets: AmkrRouteTarget[];
  aliases: string;
  mode: string;
};

const draftFromRoute = (route: AmkrRoute): RouteDraft => ({
  originalId: route.id,
  id: route.id,
  targets: route.targets.length ? route.targets.map((target) => ({ ...target })) : [{ provider: "", pool: "", upstream_model: "" }],
  aliases: route.aliases.join(", "),
  mode: route.routing_mode ?? "round_robin",
});

type RoutingPageProps = {
  configPath: string | null;
  onUnifiedModelChange?: (unifiedModel: AmkrUnifiedModel | null) => void;
};

export function RoutingPage({ configPath, onUnifiedModelChange }: RoutingPageProps) {
  const [data, setData] = useState<AmkrRoutesResponse | null>(null);
  const [id, setId] = useState("");
  const [provider, setProvider] = useState("");
  const [pool, setPool] = useState("");
  const [model, setModel] = useState("");
  const [aliases, setAliases] = useState("");
  const [mode, setMode] = useState("round_robin");
  const [editing, setEditing] = useState<RouteDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [unifiedModelRefreshToken, setUnifiedModelRefreshToken] = useState(0);

  const refresh = async () => {
    setLoading(true);
    try { setData(await getAmkrRoutes(configPath)); setError(null); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, [configPath]);

  const create = async () => {
    if (!data) return;
    try {
      await createAmkrRoute(data.config_revision, id, provider, pool, model, csv(aliases), mode || null, configPath);
      setId(""); setProvider(""); setPool(""); setModel(""); setAliases("");
      await refresh();
      setUnifiedModelRefreshToken((value) => value + 1);
    } catch (reason) {
      const message = errorMessage(reason);
      if (isConflict(message)) await refresh();
      setError(message);
    }
  };

  const save = async () => {
    if (!data || !editing) return;
    try {
      await updateAmkrRoute(data.config_revision, editing.originalId, editing.id, editing.targets, csv(editing.aliases), editing.mode || null, configPath);
      setEditing(null);
      await refresh();
      setUnifiedModelRefreshToken((value) => value + 1);
    } catch (reason) {
      const message = errorMessage(reason);
      if (isConflict(message)) await refresh();
      setError(message);
    }
  };

  const remove = async (routeId: string) => {
    if (!data || !window.confirm(`删除模型路由 ${routeId}？`)) return;
    try { await deleteAmkrRoute(data.config_revision, routeId, configPath); await refresh(); setUnifiedModelRefreshToken((value) => value + 1); }
    catch (reason) {
      const message = errorMessage(reason);
      if (isConflict(message)) await refresh();
      setError(message);
    }
  };

  const updatePrimaryTarget = (field: keyof AmkrRouteTarget, value: string) => {
    if (!editing) return;
    const targets = editing.targets.map((target, index) => index === 0 ? { ...target, [field]: value } : target);
    setEditing({ ...editing, targets });
  };

  return <section className="routes-page" aria-labelledby="routes-heading">
    <header className="page-header"><div><h2 id="routes-heading">模型路由</h2><p>管理模型别名、路由模式和上游目标。</p></div>{data ? <span className="config-revision">版本 {data.config_revision.slice(0, 12)}</span> : null}</header>
    <UnifiedModelPanel configPath={configPath} refreshToken={unifiedModelRefreshToken} onChange={onUnifiedModelChange} />
    <form className="route-create" onSubmit={(event) => { event.preventDefault(); void create(); }}>
      <label>模型 ID<input required value={id} onChange={(event) => setId(event.target.value)} /></label>
      <label>供应商<input required value={provider} onChange={(event) => setProvider(event.target.value)} /></label>
      <label>模型池<input required value={pool} onChange={(event) => setPool(event.target.value)} /></label>
      <label>上游模型<input required value={model} onChange={(event) => setModel(event.target.value)} /></label>
      <label>别名<input value={aliases} placeholder="逗号分隔" onChange={(event) => setAliases(event.target.value)} /></label>
      <label>模式<select value={mode} onChange={(event) => setMode(event.target.value)}><option value="round_robin">轮询</option><option value="priority">优先级</option></select></label>
      <button type="submit" disabled={!data || loading}>添加路由</button>
    </form>
    {loading ? <p className="empty-state">正在读取模型路由。</p> : null}
    {error ? <p className="service-action-error">无法读取或写入模型路由: {error}</p> : null}
    {data?.routes.length === 0 ? <p className="empty-state">尚未配置模型路由。</p> : null}
    <div className="route-list">{data?.routes.map((route) => <article className="route-item" key={route.id}>
      <header>
        <div><h3>{route.id}</h3><p>{route.aliases.length ? route.aliases.join(", ") : "无别名"}</p></div>
        <div className="item-actions"><span>{route.routing_mode ?? "默认策略"}</span><button aria-label={`编辑路由 ${route.id}`} className="secondary-button" type="button" onClick={() => setEditing(draftFromRoute(route))}>编辑</button><button aria-label={`删除路由 ${route.id}`} className="danger-button" type="button" onClick={() => void remove(route.id)}>删除</button></div>
      </header>
      <ul aria-label={`${route.id} 的路由目标`}>{route.targets.map((target) => <li key={`${target.provider}:${target.pool}:${target.upstream_model}`}>{target.provider} / {target.pool} / {target.upstream_model}</li>)}</ul>
      {editing?.originalId === route.id ? <form className="inline-form editor-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label>编辑模型 ID<input required value={editing.id} onChange={(event) => setEditing({ ...editing, id: event.target.value })} /></label>
        <label>编辑供应商<input required value={editing.targets[0].provider} onChange={(event) => updatePrimaryTarget("provider", event.target.value)} /></label>
        <label>编辑模型池<input required value={editing.targets[0].pool} onChange={(event) => updatePrimaryTarget("pool", event.target.value)} /></label>
        <label>编辑上游模型<input required value={editing.targets[0].upstream_model} onChange={(event) => updatePrimaryTarget("upstream_model", event.target.value)} /></label>
        <label>编辑别名<input value={editing.aliases} onChange={(event) => setEditing({ ...editing, aliases: event.target.value })} /></label>
        <label>编辑模式<select value={editing.mode} onChange={(event) => setEditing({ ...editing, mode: event.target.value })}><option value="round_robin">轮询</option><option value="priority">优先级</option></select></label>
        <button type="submit">保存路由</button>
        <button className="secondary-button" type="button" onClick={() => setEditing(null)}>取消</button>
      </form> : null}
    </article>)}</div>
  </section>;
}
