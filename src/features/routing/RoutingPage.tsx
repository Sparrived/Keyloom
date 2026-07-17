import { useEffect, useRef, useState } from "react";
import { getAmkrRoutes, updateAmkrRoute, type AmkrRoute, type AmkrRouteTarget, type AmkrRoutesResponse, type AmkrUnifiedModel } from "../../api/amkr";
import { UnifiedModelPanel } from "./UnifiedModelPanel";
import { useCopyToast } from "../../components/CopyToast";

const csv = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);
const errorMessage = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);
const isConflict = (message: string) => message.includes("HTTP 409");
const targetKey = (target: AmkrRouteTarget) => `${target.provider}\u0000${target.pool}\u0000${target.upstream_model}`;
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
  onUnifiedModelChange?: (unifiedModel: AmkrUnifiedModel | null) => void;
};

export function RoutingPage({ configPath, onUnifiedModelChange }: RoutingPageProps) {
  const [data, setData] = useState<AmkrRoutesResponse | null>(null);
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
  const [unifiedModelRefreshToken, setUnifiedModelRefreshToken] = useState(0);
  const { copyToast, showCopyToast } = useCopyToast();

  const refresh = async () => {
    setLoading(true);
    try { setData(await getAmkrRoutes(configPath)); setError(null); }
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
      setUnifiedModelRefreshToken((value) => value + 1);
      showCopyToast("路由已保存。");
    } catch (reason) {
      const message = errorMessage(reason);
      if (isConflict(message)) await refresh();
      setError(message);
    }
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
      setUnifiedModelRefreshToken((value) => value + 1);
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
    <header className="page-header"><div><h2 id="routes-heading">模型路由</h2><p>管理路由别名和路由模式；模型与上游目标由模型池管理。</p></div>{data ? <span className="config-revision">版本 {data.config_revision.slice(0, 12)}</span> : null}</header>
    <UnifiedModelPanel configPath={configPath} refreshToken={unifiedModelRefreshToken} onChange={onUnifiedModelChange} />
    <section className="route-rules" aria-labelledby="route-rules-heading">
      <header className="route-rules-heading">
        <div><h3 id="route-rules-heading">路由规则</h3><p>路由由供应商的模型池自动生成；此处管理别名、策略和顺序。</p></div>
      </header>
    {loading ? <p className="empty-state">正在读取模型路由。</p> : null}
    {error ? <p className="service-action-error">无法读取或写入模型路由: {error}</p> : null}
    {data?.routes.length === 0 ? <div className="empty-state-panel"><div><strong>尚未生成模型路由。</strong><p>请先在供应商的模型池中配置模型，路由会自动出现在这里。</p></div></div> : null}
    <div className="route-list">{data?.routes.map((route) => {
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
        onPointerUp={(event) => {
          const activeTarget = draggingTargetRef.current;
          const target = (event.target as HTMLElement).closest<HTMLElement>("[data-target-key]");
          const overTarget = dragOverTargetRef.current;
          if (activeTarget?.routeId === route.id && target?.dataset.routeId === route.id && target.dataset.targetKey && overTarget?.key === target.dataset.targetKey) void saveTargetOrder(route, overTarget, activeTarget);
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
        >{target.provider} / {target.pool} / {target.upstream_model}</li>;
          });
        })()}
      </ul>
      {editing?.originalId === route.id ? <form className="inline-form editor-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label>编辑别名<input value={editing.aliases} onChange={(event) => setEditing({ ...editing, aliases: event.target.value })} /></label>
        <label>编辑模式<select value={editing.mode} onChange={(event) => setEditing({ ...editing, mode: event.target.value })}><option value="round_robin">轮询</option><option value="priority">优先级</option><option value="only_first">首 Key</option></select></label>
        <div className="form-actions">
          <button className="secondary-button" type="button" onClick={() => setEditing(null)}>取消</button>
          <button type="submit">保存路由</button>
        </div>
      </form> : null}
    </article>;
    })}</div>
    </section>
    {copyToast}
  </section>;
}
