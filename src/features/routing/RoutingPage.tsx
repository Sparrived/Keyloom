import { useEffect, useState } from "react";
import { createAmkrRoute, deleteAmkrRoute, getAmkrRoutes, updateAmkrRoute, type AmkrRoute, type AmkrRouteTarget, type AmkrRoutesResponse, type AmkrUnifiedModel } from "../../api/amkr";
import { UnifiedModelPanel } from "./UnifiedModelPanel";
import { useCopyToast } from "../../components/CopyToast";
import { useConfirmDialog } from "../../components/ConfirmDialog";

const csv = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);
const errorMessage = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);
const isConflict = (message: string) => message.includes("HTTP 409");
const emptyTarget = (): AmkrRouteTarget => ({ provider: "", pool: "", upstream_model: "" });
const hasCompleteTargets = (targets: AmkrRouteTarget[]) => targets.length > 0 && targets.every((target) => target.provider.trim() && target.pool.trim() && target.upstream_model.trim());

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
  targets: route.targets.length ? route.targets.map((target) => ({ ...target })) : [emptyTarget()],
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
  const [createTargets, setCreateTargets] = useState<AmkrRouteTarget[]>([emptyTarget()]);
  const [aliases, setAliases] = useState("");
  const [mode, setMode] = useState("round_robin");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<RouteDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [unifiedModelRefreshToken, setUnifiedModelRefreshToken] = useState(0);
  const { copyToast, showCopyToast } = useCopyToast();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const refresh = async () => {
    setLoading(true);
    try { setData(await getAmkrRoutes(configPath)); setError(null); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, [configPath]);

  const create = async () => {
    if (!data) return;
    if (!hasCompleteTargets(createTargets)) {
      setError("每个路由目标都必须完整填写。");
      return;
    }
    try {
      await createAmkrRoute(data.config_revision, id, createTargets, csv(aliases), mode || null, configPath);
      setId(""); setCreateTargets([emptyTarget()]); setAliases(""); setMode("round_robin"); setCreating(false);
      await refresh();
      setUnifiedModelRefreshToken((value) => value + 1);
      showCopyToast("路由已添加。");
    } catch (reason) {
      const message = errorMessage(reason);
      if (isConflict(message)) await refresh();
      setError(message);
    }
  };

  const save = async () => {
    if (!data || !editing) return;
    if (!hasCompleteTargets(editing.targets)) {
      setError("每个路由目标都必须完整填写。");
      return;
    }
    try {
      await updateAmkrRoute(data.config_revision, editing.originalId, editing.id, editing.targets, csv(editing.aliases), editing.mode || null, configPath);
      setEditing(null);
      await refresh();
      setUnifiedModelRefreshToken((value) => value + 1);
      showCopyToast("路由已保存。");
    } catch (reason) {
      const message = errorMessage(reason);
      if (isConflict(message)) await refresh();
      setError(message);
    }
  };

  const remove = async (routeId: string) => {
    if (!data || !await confirm(`删除模型路由 ${routeId}？`)) return;
    try { await deleteAmkrRoute(data.config_revision, routeId, configPath); await refresh(); setUnifiedModelRefreshToken((value) => value + 1); showCopyToast("路由已删除。"); }
    catch (reason) {
      const message = errorMessage(reason);
      if (isConflict(message)) await refresh();
      setError(message);
    }
  };

  const updateCreateTarget = (index: number, field: keyof AmkrRouteTarget, value: string) => {
    setCreateTargets((targets) => targets.map((target, targetIndex) => targetIndex === index ? { ...target, [field]: value } : target));
  };

  const updateEditingTarget = (index: number, field: keyof AmkrRouteTarget, value: string) => {
    if (!editing) return;
    setEditing({ ...editing, targets: editing.targets.map((target, targetIndex) => targetIndex === index ? { ...target, [field]: value } : target) });
  };

  const addCreateTarget = () => setCreateTargets((targets) => [...targets, emptyTarget()]);
  const removeCreateTarget = (index: number) => setCreateTargets((targets) => targets.length > 1 ? targets.filter((_, targetIndex) => targetIndex !== index) : targets);
  const addEditingTarget = () => setEditing((current) => current ? { ...current, targets: [...current.targets, emptyTarget()] } : current);
  const removeEditingTarget = (index: number) => setEditing((current) => current && current.targets.length > 1 ? { ...current, targets: current.targets.filter((_, targetIndex) => targetIndex !== index) } : current);

  const cancelCreate = () => {
    setId("");
    setCreateTargets([emptyTarget()]);
    setAliases("");
    setMode("round_robin");
    setError(null);
    setCreating(false);
  };

  const toggleCreate = () => {
    if (creating) cancelCreate();
    else {
      setEditing(null);
      setError(null);
      setCreating(true);
    }
  };

  const targetLabel = (prefix: string, index: number) => `${prefix}${index === 0 ? "" : ` ${index + 1}`}`;

  return <section className="routes-page" aria-labelledby="routes-heading">
    <header className="page-header"><div><h2 id="routes-heading">模型路由</h2><p>管理模型别名、路由模式和上游目标。</p></div>{data ? <span className="config-revision">版本 {data.config_revision.slice(0, 12)}</span> : null}</header>
    <UnifiedModelPanel configPath={configPath} refreshToken={unifiedModelRefreshToken} onChange={onUnifiedModelChange} />
    <section className="route-rules" aria-labelledby="route-rules-heading">
      <header className="route-rules-heading">
        <div><h3 id="route-rules-heading">路由规则</h3><p>将模型 ID 映射到一个或多个上游目标。</p></div>
        {data?.routes.length !== 0 ? <button aria-expanded={creating} className="secondary-button" type="button" onClick={toggleCreate}>{creating ? "取消新增" : "新增路由"}</button> : null}
      </header>
    {creating ? <form className="route-create" onSubmit={(event) => { event.preventDefault(); void create(); }}>
      <label>模型 ID<input required value={id} onChange={(event) => setId(event.target.value)} /></label>
      <label>别名<input value={aliases} placeholder="逗号分隔" onChange={(event) => setAliases(event.target.value)} /></label>
      <label>模式<select value={mode} onChange={(event) => setMode(event.target.value)}><option value="round_robin">轮询</option><option value="priority">优先级</option><option value="only_first">首 Key</option></select></label>
      <fieldset className="route-targets" aria-label="创建路由目标">
        <legend>上游目标</legend>
        {createTargets.map((target, index) => <div className="route-target-row" key={index}>
          <label>{targetLabel("供应商", index)}<input required aria-label={targetLabel("供应商", index)} value={target.provider} onChange={(event) => updateCreateTarget(index, "provider", event.target.value)} /></label>
          <label>{targetLabel("模型池", index)}<input required aria-label={targetLabel("模型池", index)} value={target.pool} onChange={(event) => updateCreateTarget(index, "pool", event.target.value)} /></label>
          <label>{targetLabel("上游模型", index)}<input required aria-label={targetLabel("上游模型", index)} value={target.upstream_model} onChange={(event) => updateCreateTarget(index, "upstream_model", event.target.value)} /></label>
          <button aria-label={`删除创建路由目标 ${index + 1}`} className="secondary-button" type="button" disabled={createTargets.length === 1} onClick={() => removeCreateTarget(index)}>删除目标</button>
        </div>)}
        <button aria-label="添加路由目标" className="secondary-button" type="button" onClick={addCreateTarget}>添加目标</button>
      </fieldset>
      <div className="form-actions">
        <button className="secondary-button" type="button" onClick={cancelCreate}>取消</button>
        <button type="submit" disabled={!data || loading}>添加路由</button>
      </div>
    </form> : null}
    {loading ? <p className="empty-state">正在读取模型路由。</p> : null}
    {error ? <p className="service-action-error">无法读取或写入模型路由: {error}</p> : null}
    {data?.routes.length === 0 ? <div className="empty-state-panel"><div><strong>尚未配置模型路由。</strong><p>为模型 ID 指定一个或多个上游目标后，请求才会被正确转发。</p></div><button type="button" onClick={toggleCreate}>新增路由</button></div> : null}
    <div className="route-list">{data?.routes.map((route) => <article className="route-item" key={route.id}>
      <header>
        <div><h3>{route.id}</h3><p>{route.aliases.length ? route.aliases.join(", ") : "无别名"}</p></div>
        <div className="item-actions"><span>{route.routing_mode ?? "默认策略"}</span><button aria-expanded={editing?.originalId === route.id} aria-label={`${editing?.originalId === route.id ? "收起" : "编辑"}路由 ${route.id}`} className="secondary-button" type="button" onClick={() => { cancelCreate(); setEditing((current) => current?.originalId === route.id ? null : draftFromRoute(route)); }}>{editing?.originalId === route.id ? "收起" : "编辑"}</button><button aria-label={`删除路由 ${route.id}`} className="danger-button" type="button" onClick={() => void remove(route.id)}>删除</button></div>
      </header>
      <ul aria-label={`${route.id} 的路由目标`}>{route.targets.map((target, index) => <li key={`${target.provider}:${target.pool}:${target.upstream_model}:${index}`}>{target.provider} / {target.pool} / {target.upstream_model}</li>)}</ul>
      {editing?.originalId === route.id ? <form className="inline-form editor-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label>编辑模型 ID<input required value={editing.id} onChange={(event) => setEditing({ ...editing, id: event.target.value })} /></label>
        <label>编辑别名<input value={editing.aliases} onChange={(event) => setEditing({ ...editing, aliases: event.target.value })} /></label>
        <label>编辑模式<select value={editing.mode} onChange={(event) => setEditing({ ...editing, mode: event.target.value })}><option value="round_robin">轮询</option><option value="priority">优先级</option><option value="only_first">首 Key</option></select></label>
        <fieldset className="route-targets" aria-label={`编辑 ${route.id} 的路由目标`}>
          <legend>上游目标</legend>
          {editing.targets.map((target, index) => <div className="route-target-row" key={index}>
            <label>{targetLabel("编辑供应商", index)}<input required aria-label={targetLabel("编辑供应商", index)} value={target.provider} onChange={(event) => updateEditingTarget(index, "provider", event.target.value)} /></label>
            <label>{targetLabel("编辑模型池", index)}<input required aria-label={targetLabel("编辑模型池", index)} value={target.pool} onChange={(event) => updateEditingTarget(index, "pool", event.target.value)} /></label>
            <label>{targetLabel("编辑上游模型", index)}<input required aria-label={targetLabel("编辑上游模型", index)} value={target.upstream_model} onChange={(event) => updateEditingTarget(index, "upstream_model", event.target.value)} /></label>
            <button aria-label={`删除路由目标 ${index + 1}`} className="secondary-button" type="button" disabled={editing.targets.length === 1} onClick={() => removeEditingTarget(index)}>删除目标</button>
          </div>)}
          <button aria-label="添加编辑路由目标" className="secondary-button" type="button" onClick={addEditingTarget}>添加目标</button>
        </fieldset>
        <div className="form-actions">
          <button className="secondary-button" type="button" onClick={() => setEditing(null)}>取消</button>
          <button type="submit">保存路由</button>
        </div>
      </form> : null}
    </article>)}</div>
    </section>
    {confirmDialog}
    {copyToast}
  </section>;
}
