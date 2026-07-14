import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow, LogicalSize, PhysicalPosition } from "@tauri-apps/api/window";
import {
  getAmkrMetrics,
  getAmkrModels,
  getAmkrUnifiedModel,
  updateAmkrUnifiedModel,
  type AmkrMetrics,
  type AmkrModel,
  type AmkrUnifiedModel,
  type AmkrUsageStats,
} from "../api/amkr";

const configPathStorageKey = "keyloom.configPath";
const widgetEnabledStorageKey = "keyloom.amkrWidgetEnabled";
const widgetPositionStorageKey = "keyloom.amkrWidgetPosition";

function configPath() {
  return localStorage.getItem(configPathStorageKey) || null;
}

function formatNumber(value: number | null | undefined) {
  const number = value ?? 0;
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}M`;
  if (number >= 10_000) return `${(number / 1_000).toFixed(1)}K`;
  return new Intl.NumberFormat("zh-CN").format(number);
}

function formatDuration(value: number | null | undefined) {
  const milliseconds = value ?? 0;
  return milliseconds >= 1_000 ? `${(milliseconds / 1_000).toFixed(1)}s` : `${Math.round(milliseconds)}ms`;
}

function successRate(stats: AmkrUsageStats) {
  return stats.requests > 0 ? ((stats.successes ?? 0) / stats.requests) * 100 : 0;
}

function shortModelName(model: AmkrModel) {
  return model.id.length > 25 && model.aliases.length > 0 ? model.aliases[0] : model.id;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="amkr-widget-metric"><strong>{value}</strong><span>{label}</span></div>;
}

function ModelTable({ models }: { models: Record<string, AmkrUsageStats> }) {
  const entries = Object.entries(models);
  if (entries.length === 0) return null;
  return <div className="amkr-widget-models">
    <table>
      <thead><tr><th>模型</th><th>请求</th><th>成功率</th><th>延迟</th><th>Token</th></tr></thead>
      <tbody>{entries.map(([name, stats]) => <tr key={name}>
        <td title={name}>{name}</td>
        <td>{formatNumber(stats.requests)}</td>
        <td>{successRate(stats).toFixed(1)}%</td>
        <td>{formatDuration(stats.avg_duration_ms)}</td>
        <td>{formatNumber(stats.total_tokens)}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export function AmkrWidget() {
  const rootRef = useRef<HTMLElement>(null);
  const lastHeight = useRef(0);
  const [metrics, setMetrics] = useState<AmkrMetrics | null>(null);
  const [models, setModels] = useState<AmkrModel[]>([]);
  const [unifiedModel, setUnifiedModel] = useState<AmkrUnifiedModel | null>(null);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  const refreshMetrics = useCallback(async () => {
    try {
      setMetrics(await getAmkrMetrics(configPath()));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);

  useEffect(() => {
    const currentWindow = getCurrentWindow();
    try {
      const saved = JSON.parse(localStorage.getItem(widgetPositionStorageKey) ?? "null") as { x: number; y: number } | null;
      if (saved) void currentWindow.setPosition(new PhysicalPosition(saved.x, saved.y));
    } catch {
      localStorage.removeItem(widgetPositionStorageKey);
    }
    const unlistenMoved = currentWindow.onMoved(({ payload }) => localStorage.setItem(widgetPositionStorageKey, JSON.stringify(payload)));
    void refreshMetrics();
    const interval = window.setInterval(() => void refreshMetrics(), 2_000);
    return () => {
      window.clearInterval(interval);
      void unlistenMoved.then((unlisten) => unlisten());
    };
  }, [refreshMetrics]);

  useEffect(() => {
    void Promise.all([getAmkrModels(configPath()), getAmkrUnifiedModel(configPath())])
      .then(([modelResponse, unifiedResponse]) => {
        setModels(modelResponse.models);
        setUnifiedModel(unifiedResponse.unified_model);
      })
      .catch(() => undefined);
  }, []);

  useLayoutEffect(() => {
    const height = Math.ceil(rootRef.current?.getBoundingClientRect().height ?? 0);
    if (height > 0 && height !== lastHeight.current) {
      lastHeight.current = height;
      void getCurrentWindow().setSize(new LogicalSize(360, height));
    }
  }, [error, metrics]);

  const currentModel = useMemo(
    () => models.find((model) => model.id === unifiedModel?.default.primary.model),
    [models, unifiedModel],
  );

  async function selectModel(modelId: string) {
    setModelsOpen(false);
    setSwitching(true);
    try {
      const next: AmkrUnifiedModel = unifiedModel
        ? { ...unifiedModel, default: { ...unifiedModel.default, primary: { model: modelId, key: null } } }
        : { default: { primary: { model: modelId, key: null } } };
      const response = await updateAmkrUnifiedModel(next, configPath());
      setUnifiedModel(response.unified_model);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSwitching(false);
    }
  }

  async function closeWidget() {
    localStorage.setItem(widgetEnabledStorageKey, "false");
    await getCurrentWindow().hide();
  }

  function startDragging(event: React.MouseEvent) {
    if (event.button === 0 && !(event.target as Element).closest("button")) {
      void getCurrentWindow().startDragging().catch(() => undefined);
    }
  }

  const total = metrics?.total;
  const rate = total ? successRate(total) : 0;
  const status = metrics?.router_status === "yellow" ? "重试中" : metrics?.router_status === "red" ? "异常" : metrics ? "正常" : "未连接";

  return <main className="amkr-widget-root" ref={rootRef}>
    <header className="amkr-widget-header" onMouseDown={startDragging}>
      <div className="amkr-widget-title"><span className="amkr-widget-mark"><span>A</span><span>M</span><span>K</span><span>R</span></span><span>仪表盘</span></div>
      <div className="amkr-widget-status" role="status">
        <span className={`amkr-widget-status-dot status-${metrics?.router_status ?? "off"}`} />
        <span>{status}</span>
        {(metrics?.active_requests ?? 0) > 0 ? <strong>{metrics?.active_requests}</strong> : null}
      </div>
      <button className="amkr-widget-close" aria-label="关闭 AMKR 挂件" title="关闭" type="button" onClick={() => void closeWidget()}>×</button>
    </header>

    <section className="amkr-widget-body">
      <div className="amkr-widget-toolbar">
        <div className="amkr-widget-selector">
          <button aria-expanded={modelsOpen} disabled={models.length === 0 || switching} title={currentModel?.id ?? "选择统一模型"} type="button" onClick={() => setModelsOpen((open) => !open)}>
            <span>unified</span><strong>{currentModel ? shortModelName(currentModel) : "未配置"}</strong><span aria-hidden="true">▾</span>
          </button>
          {modelsOpen ? <div className="amkr-widget-dropdown">{models.map((model) => <button className={model.id === currentModel?.id ? "is-current" : undefined} key={model.id} title={model.aliases.join(", ") || model.id} type="button" onClick={() => void selectModel(model.id)}>{model.id}</button>)}</div> : null}
        </div>
        <div className="amkr-widget-rates"><span>{formatNumber(metrics?.current_rpm)} rpm</span><span>{formatNumber(metrics?.current_tpm)} tpm</span></div>
      </div>

      {error && !metrics ? <div className="amkr-widget-empty"><strong>AMKR 暂不可用</strong><span title={error}>无法连接到本机 AMKR 服务</span></div> : total ? <>
        <div className="amkr-widget-headline">
          <Metric label="总请求" value={formatNumber(total.requests)} />
          <Metric label="成功率" value={`${rate.toFixed(1)}%`} />
          <Metric label="首 Token" value={formatDuration(total.avg_first_token_ms)} />
          <Metric label="平均延迟" value={formatDuration(total.avg_duration_ms)} />
        </div>

        <div className="amkr-widget-bars">
          <div><span><small>成功率</small><strong>{rate.toFixed(1)}%</strong></span><i><b style={{ width: `${Math.min(100, rate)}%` }} /></i></div>
          <div><span><small>Token 缓存</small><strong>{((total.cached_token_rate ?? 0) * 100).toFixed(1)}%</strong></span><i><b style={{ width: `${Math.min(100, (total.cached_token_rate ?? 0) * 100)}%` }} /></i></div>
        </div>

        <div className="amkr-widget-tokens">
          <Metric label="输入" value={formatNumber(total.prompt_tokens)} />
          <Metric label="输出" value={formatNumber(total.completion_tokens)} />
          <Metric label="缓存" value={formatNumber(total.cached_tokens)} />
          <Metric label="总计" value={formatNumber(total.total_tokens)} />
        </div>

        <ModelTable models={metrics.models ?? {}} />
      </> : <div className="amkr-widget-empty">正在连接 AMKR</div>}
    </section>
  </main>;
}
