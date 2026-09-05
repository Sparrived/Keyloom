import { useEffect, useRef, useState } from "react";
import { getAmkrProviders, getAmkrRoutes, probeAmkrKey, updateAmkrRoute, type AmkrProvider, type AmkrRoute, type AmkrRouteTarget, type AmkrRoutesResponse } from "../../api/amkr";
import { useCopyToast } from "../../components/CopyToast";

const csv = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);
const errorMessage = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);
const isConflict = (message: string) => message.includes("HTTP 409");
const targetKey = (target: AmkrRouteTarget) => `${target.provider}\u0000${target.key}\u0000${target.upstream_model}`;
const routingModeLabel = (mode: string | null | undefined) => ({ round_robin: "轮询", priority: "优先级", only_first: "首 Key" }[mode ?? ""] ?? "默认策略");
type DragTarget = { routeId: string; key: string };
type DragOverTarget = DragTarget & { position: "before" | "after" };
type RouteDraft = {
  originalId: string;
  targets: AmkrRouteTarget[];
  aliases: string;
  mode: string;
};

const draftFromRoute = (route: AmkrRoute): RouteDraft => ({
  originalId: route.id,
  targets: route.targets.map((target) => ({ ...target })),
  aliases: route.aliases.join(", "),
  mode: route.routing_mode ?? "round_robin",
});

type RoutingPageProps = {
  configPath: string | null;
};

export function RoutingPage({ configPath }: RoutingPageProps) {
  const [data, setData] = useState<AmkrRoutesResponse | null>(null);
  const [providers, setProviders] = useState<AmkrProvider[]>([]);
  const [probingKeys, setProbingKeys] = useState<string[]>([]);
  const [editing, setEditing] = useState<RouteDraft | null>(null);
  const [draggingTarget, setDraggingTarget] = useState<DragTarget | null>(null);
  const draggingTargetRef = useRef<DragTarget | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<DragOverTarget | null>(null);
  const dragOverTargetRef = useRef<DragOverTarget | null>(null);
  const [dragAnimationFrom, setDragAnimationFrom] = useState<{ routeId: string; fromTargets: AmkrRouteTarget[] } | null>(null);
  const dragAnimationTimerRef = useRef<number | null>(null);
  const [dragReturn, setDragReturn] = useState<{ routeId: string; fromTargets: AmkrRouteTarget[] } | null>(null);
  const [savingTargetOrder, setSavingTargetOrder] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeRouteId, setActiveRouteId] = useState("");
  const { copyToast, showCopyToast } = useCopyToast();

  const refresh = async () => {
    setLoading(true);
    try {
      const [next, providerData] = await Promise.all([getAmkrRoutes(configPath), getAmkrProviders(configPath)]);
      setData(next);
      const loadedProviders = providerData?.providers ?? [];
      setProviders(loadedProviders);
      const missingKeys = loadedProviders.flatMap((provider) => provider.keys.filter((key) => !key.capabilities).map((key) => `${provider.id}\u0000${key.name}`));
      if (missingKeys.length) {
        setProbingKeys(missingKeys);
        let revision = providerData.config_revision;
        for (const identity of missingKeys) {
          const [providerId, keyName] = identity.split("\u0000");
          try {
            const result = await probeAmkrKey(revision, providerId, keyName, configPath);
            revision = result.config_revision;
          } catch {
            // Keep the key visible; the provider page exposes the detailed error.
          }
        }
        setProbingKeys([]);
        const refreshed = await getAmkrProviders(configPath);
        setProviders(refreshed.providers);
      }
      setActiveRouteId((current) => next.routes.some((route) => route.id === current) ? current : next.routes[0]?.id ?? "");
      setError(null);
    }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, [configPath]);

  const save = async () => {
    if (!data || !editing) return;
    try {
      await updateAmkrRoute(data.config_revision, editing.originalId, editing.targets, csv(editing.aliases), editing.mode || null, configPath);
      setEditing(null);
      await refresh();
      showCopyToast("路由已保存。");
    } catch (reason) {
      const message = errorMessage(reason);
      if (isConflict(message)) await refresh();
      setError(message);
    }
  };

  const candidateTargets = (route: AmkrRoute) => {
    const existing = new Set(route.targets.map((target) => `${target.provider}\u0000${target.key}`));
    const candidates: AmkrRouteTarget[] = [];
    for (const provider of providers) {
      for (const key of provider.keys) {
        if (key.capabilities?.models?.includes(route.id) && !existing.has(`${provider.id}\u0000${key.name}`)) {
          candidates.push({ provider: provider.id, key: key.name, upstream_model: route.id });
        }
      }
    }
    return candidates;
  };

  const toggleTarget = (route: AmkrRoute, target: AmkrRouteTarget) => {
    if (!editing || editing.originalId !== route.id) return;
    const identity = `${target.provider}\u0000${target.key}`;
    const index = editing.targets.findIndex((item) => `${item.provider}\u0000${item.key}` === identity);
    const targets = index >= 0
      ? editing.targets.filter((_, targetIndex) => targetIndex !== index)
      : [...editing.targets, target];
    setEditing({ ...editing, targets });
  };

  const moveTargets = (targets: AmkrRouteTarget[], sourceIndex: number, targetIndex: number) => {
    if (sourceIndex === targetIndex) return targets;
    const nextTargets = [...targets];
    const [target] = nextTargets.splice(sourceIndex, 1);
    nextTargets.splice(targetIndex, 0, target);
    return nextTargets;
  };

  const moveTargetsByKey = (targets: AmkrRouteTarget[], sourceKey: string, targetKeyValue: string, position: "before" | "after") => {
    const sourceIndex = targets.findIndex((target) => targetKey(target) === sourceKey);
    const targetIndex = targets.findIndex((target) => targetKey(target) === targetKeyValue);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return targets;
    const nextTargets = [...targets];
    const [source] = nextTargets.splice(sourceIndex, 1);
    const nextTargetIndex = nextTargets.findIndex((target) => targetKey(target) === targetKeyValue);
    nextTargets.splice(nextTargetIndex + (position === "after" ? 1 : 0), 0, source);
    return nextTargets;
  };

  const clearDrag = () => {
    draggingTargetRef.current = null;
    dragOverTargetRef.current = null;
    if (dragAnimationTimerRef.current !== null) window.clearTimeout(dragAnimationTimerRef.current);
    dragAnimationTimerRef.current = null;
    setDragAnimationFrom(null);
    setDraggingTarget(null);
    setDragOverTarget(null);
  };

  const cancelDrag = () => {
    const activeTarget = draggingTargetRef.current;
    const overTarget = dragOverTargetRef.current;
    const route = data?.routes.find((item) => item.id === activeTarget?.routeId);
    if (route && activeTarget && overTarget?.routeId === route.id && activeTarget.key !== overTarget.key) {
      setDragReturn({ routeId: route.id, fromTargets: moveTargetsByKey(route.targets, activeTarget.key, overTarget.key, overTarget.position) });
      window.setTimeout(() => setDragReturn(null), 180);
    }
    clearDrag();
  };

  const updateDragOver = (route: AmkrRoute, overTarget: DragOverTarget) => {
    const activeTarget = draggingTargetRef.current;
    if (!activeTarget || activeTarget.routeId !== route.id || activeTarget.key === overTarget.key) return;
    const previousOver = dragOverTargetRef.current;
    const fromTargets = previousOver?.routeId === route.id
      ? moveTargetsByKey(route.targets, activeTarget.key, previousOver.key, previousOver.position)
      : route.targets;
    setDragAnimationFrom({ routeId: route.id, fromTargets });
    if (dragAnimationTimerRef.current !== null) window.clearTimeout(dragAnimationTimerRef.current);
    dragAnimationTimerRef.current = window.setTimeout(() => {
      dragAnimationTimerRef.current = null;
      setDragAnimationFrom(null);
    }, 180);
    dragOverTargetRef.current = overTarget;
    setDragOverTarget(overTarget);
  };

  useEffect(() => {
    if (!draggingTarget) return;
    window.addEventListener("pointerup", cancelDrag);
    window.addEventListener("pointercancel", cancelDrag);
    return () => {
      window.removeEventListener("pointerup", cancelDrag);
      window.removeEventListener("pointercancel", cancelDrag);
    };
  }, [draggingTarget]);

  const saveTargetOrder = async (route: AmkrRoute, overTarget: DragOverTarget | null, activeTarget = draggingTargetRef.current) => {
    if (!data || !activeTarget || !overTarget || activeTarget.routeId !== route.id || overTarget.routeId !== route.id || activeTarget.key === overTarget.key || savingTargetOrder) { clearDrag(); return; }
    const targets = moveTargetsByKey(route.targets, activeTarget.key, overTarget.key, overTarget.position);
    setSavingTargetOrder(route.id);
    clearDrag();
    setError(null);
    try {
      await updateAmkrRoute(data.config_revision, route.id, targets, route.aliases, route.routing_mode ?? null, configPath);
      if (editing?.originalId === route.id) setEditing(null);
      await refresh();
      showCopyToast("路由目标顺序已保存。");
    } catch (reason) {
      const message = errorMessage(reason);
      if (isConflict(message)) await refresh();
      setError(message);
    } finally {
      setSavingTargetOrder(null);
    }
  };

  return <section className="routes-page" aria-labelledby="routes-heading">
    <header className="page-header"><div><h2 id="routes-heading">模型路由</h2><p>管理路由别名和路由模式；模型的目标 Key 在下方按顺序排列。</p></div>{data ? <span className="config-revision">版本 {data.config_revision.slice(0, 12)}</span> : null}</header>
    <section className="route-rules" aria-labelledby="route-rules-heading">
      <header className="route-rules-heading">
        <div><h3 id="route-rules-heading">路由规则</h3><p>路由来自模型配置；此处管理别名、策略和回退顺序。</p>{probingKeys.length ? <p className="editor-help" role="status">正在自动探测 {probingKeys.length} 个 Key…</p> : null}</div>
      </header>
    {loading ? <p className="empty-state">正在读取模型路由。</p> : null}
    {error ? <p className="service-action-error">无法读取或写入模型路由: {error}</p> : null}
    {data?.routes.length === 0 ? <div className="empty-state-panel"><div><strong>尚未配置模型路由。</strong><p>请先添加模型并绑定其目标 Key，路由会自动出现在这里。</p></div></div> : null}
    {data?.routes.length ? <div className="configuration-tabs route-tabs">
      <div aria-label="模型列表" className="configuration-tablist" role="tablist">
        {data.routes.map((route) => {
          const selected = route.id === activeRouteId;
          return <button
            aria-controls={`route-list-${encodeURIComponent(route.id)}`}
            aria-selected={selected}
            className="configuration-tab"
            id={`route-tab-${encodeURIComponent(route.id)}`}
            key={route.id}
            role="tab"
            tabIndex={selected ? 0 : -1}
            type="button"
            aria-label={route.id}
            onClick={() => { setActiveRouteId(route.id); setEditing(null); }}
            onKeyDown={(event) => {
              const index = data.routes.findIndex((item) => item.id === route.id);
              const nextIndex = event.key === "ArrowRight" ? (index + 1) % data.routes.length : event.key === "ArrowLeft" ? (index - 1 + data.routes.length) % data.routes.length : -1;
              if (nextIndex < 0) return;
              event.preventDefault();
              const nextRoute = data.routes[nextIndex];
              setActiveRouteId(nextRoute.id);
              setEditing(null);
              window.setTimeout(() => document.getElementById(`route-tab-${encodeURIComponent(nextRoute.id)}`)?.focus(), 0);
            }}
          ><strong>模型 · {route.id}</strong><span>{routingModeLabel(route.routing_mode)} · {route.targets.length} 个目标</span></button>;
        })}
      </div>
    <div aria-labelledby={`route-tab-${encodeURIComponent(activeRouteId)}`} className="configuration-tabpanel" id={`route-list-${encodeURIComponent(activeRouteId)}`} role="tabpanel" tabIndex={0}>
    <div className="route-list">{data?.routes.filter((route) => route.id === activeRouteId).map((route) => {
      const previewing = draggingTarget?.routeId === route.id && dragOverTarget?.routeId === route.id;
      const visibleTargets = previewing ? moveTargetsByKey(route.targets, draggingTarget.key, dragOverTarget.key, dragOverTarget.position) : route.targets;
      return <article className="route-item" key={route.id}>
      <header>
        <div><h3>{route.id}</h3><p>{route.aliases.length ? route.aliases.join(", ") : "无别名"}</p></div>
        <div className="item-actions"><span>{routingModeLabel(route.routing_mode)}</span><button aria-expanded={editing?.originalId === route.id} aria-label={`${editing?.originalId === route.id ? "收起" : "编辑"}路由 ${route.id}`} className="secondary-button" type="button" onClick={() => setEditing((current) => current?.originalId === route.id ? null : draftFromRoute(route))}>{editing?.originalId === route.id ? "收起" : "编辑"}</button></div>
      </header>
      <ul
        aria-label={`${route.id} 的路由目标`}
        className={`route-target-dropzone${savingTargetOrder === route.id ? " is-saving" : ""}`}
        onPointerUp={() => {
          void saveTargetOrder(route, dragOverTargetRef.current);
        }}
        onPointerCancel={cancelDrag}
      >
        {(() => {
          const returning = dragReturn?.routeId === route.id;
          const returnTargets = returning ? dragReturn.fromTargets : route.targets;
          const animationFromTargets = dragAnimationFrom?.routeId === route.id ? dragAnimationFrom.fromTargets : returning ? returnTargets : null;
          return visibleTargets.map((target) => {
          const key = targetKey(target);
          const originalIndex = route.targets.findIndex((item) => targetKey(item) === key);
          const visibleIndex = visibleTargets.findIndex((item) => targetKey(item) === key);
          const returnIndex = returnTargets.findIndex((item) => targetKey(item) === key);
          const animationFromIndex = animationFromTargets?.findIndex((item) => targetKey(item) === key) ?? visibleIndex;
          const shiftClass = animationFromTargets && animationFromIndex !== visibleIndex
            ? (visibleIndex < animationFromIndex ? "is-shifted-up" : "is-shifted-down")
            : returning && returnIndex !== visibleIndex
              ? (visibleIndex < returnIndex ? "is-returning-up" : "is-returning-down")
              : "";
          return <li
          className={`${draggingTarget?.routeId === route.id && draggingTarget.key === key ? "is-dragging " : ""}${dragOverTarget?.routeId === route.id && dragOverTarget.key === key ? `is-drag-over is-drop-${dragOverTarget.position} ` : ""}${shiftClass}`}
          data-route-id={route.id}
          data-target-key={key}
          key={key}
          onPointerDown={(event) => { if ((event.button !== undefined && event.button !== 0) || savingTargetOrder) return; event.preventDefault(); const activeTarget = { routeId: route.id, key }; draggingTargetRef.current = activeTarget; dragOverTargetRef.current = null; setDragReturn(null); setDragAnimationFrom(null); setDraggingTarget(activeTarget); setDragOverTarget(null); }}
          onPointerEnter={(event) => { const activeTarget = draggingTargetRef.current; if (activeTarget?.routeId === route.id && activeTarget.key !== key) { const rect = event.currentTarget.getBoundingClientRect(); const position = rect.height > 0 && event.clientY > rect.top + rect.height / 2 ? "after" : "before"; updateDragOver(route, { routeId: route.id, key, position }); } }}
          onPointerMove={(event) => { const activeTarget = draggingTargetRef.current; if (activeTarget?.routeId === route.id && activeTarget.key !== key) { const rect = event.currentTarget.getBoundingClientRect(); const position = rect.height > 0 && event.clientY > rect.top + rect.height / 2 ? "after" : "before"; if (dragOverTargetRef.current?.key !== key || dragOverTargetRef.current.position !== position) updateDragOver(route, { routeId: route.id, key, position }); } }}
        >{target.provider} / {target.key} / {target.upstream_model}</li>;
          });
        })()}
      </ul>
      {editing?.originalId === route.id ? <form className="inline-form editor-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label>编辑别名<input value={editing.aliases} onChange={(event) => setEditing({ ...editing, aliases: event.target.value })} /></label>
        <fieldset className="route-key-picker">
          <legend>绑定目标 Key</legend>
          <p className="editor-help">仅显示探测到模型 {route.id} 的 Key；取消勾选即可停用该 Key。</p>
          <div className="route-key-options">
            {[...editing.targets, ...candidateTargets(route)].map((target) => {
              const checked = editing.targets.some((item) => `${item.provider}\u0000${item.key}` === `${target.provider}\u0000${target.key}`);
              return <label className="route-key-option" key={`${target.provider}\u0000${target.key}`}><input type="checkbox" checked={checked} onChange={() => toggleTarget(route, target)} />{target.provider} / {target.key}<span>{target.upstream_model}</span></label>;
            })}
          </div>
        </fieldset>
        <label>编辑模式<select value={editing.mode} onChange={(event) => setEditing({ ...editing, mode: event.target.value })}><option value="round_robin">轮询</option><option value="priority">优先级</option><option value="only_first">首 Key</option></select></label>
        <div className="form-actions">
          <button className="secondary-button" type="button" onClick={() => setEditing(null)}>取消</button>
          <button type="submit">保存路由</button>
        </div>
      </form> : null}
    </article>;
    })}</div>
    </div>
    </div> : null}
    </section>
    {copyToast}
  </section>;
}
