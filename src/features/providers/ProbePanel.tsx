import { useEffect, useId, useRef, useState } from "react";
import {
  cancelAmkrProbe,
  getAmkrProbe,
  probeAmkrKeys,
  probeAmkrPools,
  type AmkrProbe,
  type AmkrProbeResult,
} from "../../api/amkr";

const pollIntervalMs = 750;
const terminalStatuses = new Set(["complete", "failed", "cancelled"]);
const statusLabels: Record<string, string> = {
  pending: "排队中",
  running: "正在探测",
  complete: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

type ProbePanelProps = {
  configPath: string | null;
  providerId: string;
  keys: string[];
  pools: string[];
  poolProbeRequest?: { id: number; pool: string; key: string | null } | null;
  onPoolProbeResults?: (results: AmkrProbeResult[]) => void;
  onPoolProbeStatus?: (status: string | null) => void;
};

const errorMessage = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);

function safeEndpoint(value: string) {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return "端点地址不可用";
  }
}

function statusTone(status: string) {
  if (status === "complete") return "good";
  if (status === "failed") return "bad";
  if (status === "cancelled") return "warn";
  return "muted";
}

export function ProbePanel({ configPath, providerId, keys, pools, poolProbeRequest = null, onPoolProbeResults, onPoolProbeStatus }: ProbePanelProps) {
  const headingId = useId();
  const [timeoutSeconds, setTimeoutSeconds] = useState("15");
  const [probe, setProbe] = useState<AmkrProbe | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const generationRef = useRef(0);
  const pollVersionRef = useRef(0);
  const activeProbeRef = useRef<string | null>(null);
  const activeProbeKindRef = useRef<"keys" | "pools" | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    ++generationRef.current;
    clearTimer();
    ++pollVersionRef.current;
    const previousProbe = activeProbeRef.current;
    activeProbeRef.current = null;
    activeProbeKindRef.current = null;
    onPoolProbeStatus?.(null);
    setProbe(null);
    setBusy(false);
    setCancelBusy(false);
    setError(null);
    if (previousProbe) void cancelAmkrProbe(previousProbe, configPath).catch(() => undefined);
    return () => {
      ++generationRef.current;
      ++pollVersionRef.current;
      clearTimer();
      const probeId = activeProbeRef.current;
      activeProbeRef.current = null;
      activeProbeKindRef.current = null;
      onPoolProbeStatus?.(null);
      if (probeId) void cancelAmkrProbe(probeId, configPath).catch(() => undefined);
    };
  }, [configPath]);

  async function poll(probeId: string, generation: number, pollVersion: number) {
    try {
      const result = await getAmkrProbe(probeId, configPath);
      if (generationRef.current !== generation || pollVersionRef.current !== pollVersion || activeProbeRef.current !== probeId) return;
      setProbe(result);
      if (activeProbeKindRef.current === "pools") onPoolProbeStatus?.(result.status);
      if (terminalStatuses.has(result.status)) {
        if (result.status === "complete" && activeProbeKindRef.current === "pools") onPoolProbeResults?.(result.results);
        activeProbeRef.current = null;
        activeProbeKindRef.current = null;
        setBusy(false);
        setCancelBusy(false);
        clearTimer();
      } else {
        timerRef.current = window.setTimeout(() => void poll(probeId, generation, pollVersion), pollIntervalMs);
      }
    } catch (reason) {
      if (generationRef.current !== generation || pollVersionRef.current !== pollVersion || activeProbeRef.current !== probeId) return;
      setCancelBusy(false);
      if (activeProbeKindRef.current === "pools") onPoolProbeStatus?.("failed");
      setError(errorMessage(reason));
      clearTimer();
    }
  }

  useEffect(() => {
    if (poolProbeRequest?.key && pools.includes(poolProbeRequest.pool) && keys.includes(poolProbeRequest.key)) {
      void start("keys", [poolProbeRequest.key], "pools");
    }
  }, [poolProbeRequest]);

  async function start(kind: "keys" | "pools", selected: string[], resultKind: "keys" | "pools" = kind) {
    if (busy) return;
    const timeout = Number(timeoutSeconds);
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 120) {
      setError("探测超时必须在 0 到 120 秒之间。");
      return;
    }
    clearTimer();
    const generation = ++generationRef.current;
    const pollVersion = ++pollVersionRef.current;
    activeProbeRef.current = null;
    activeProbeKindRef.current = null;
    setBusy(true);
    setCancelBusy(false);
    setError(null);
    setProbe(null);
    if (resultKind === "pools") onPoolProbeStatus?.("pending");
    try {
      const started = kind === "keys"
        ? await probeAmkrKeys(providerId, selected, timeout, configPath)
        : await probeAmkrPools(providerId, selected, timeout, configPath);
      if (generationRef.current !== generation) {
        void cancelAmkrProbe(started.probe_id, configPath).catch(() => undefined);
        return;
      }
      activeProbeRef.current = started.probe_id;
      activeProbeKindRef.current = resultKind;
      if (resultKind === "pools") onPoolProbeStatus?.(started.status);
      setProbe({
        probe_id: started.probe_id,
        status: started.status,
        provider: providerId,
        results: [],
        error: null,
      });
      void poll(started.probe_id, generation, pollVersion);
    } catch (reason) {
      if (generationRef.current !== generation) return;
      setBusy(false);
      if (resultKind === "pools") onPoolProbeStatus?.("failed");
      setError(errorMessage(reason));
    }
  }

  async function cancel() {
    const probeId = activeProbeRef.current;
    if (!probeId || cancelBusy) return;
    const generation = generationRef.current;
    ++pollVersionRef.current;
    clearTimer();
    setCancelBusy(true);
    setError(null);
    try {
      const result = await cancelAmkrProbe(probeId, configPath);
      if (activeProbeRef.current !== probeId) return;
      setProbe(result);
      if (terminalStatuses.has(result.status)) {
        activeProbeRef.current = null;
        activeProbeKindRef.current = null;
        setBusy(false);
        setCancelBusy(false);
        clearTimer();
      } else {
        const nextPollVersion = ++pollVersionRef.current;
        timerRef.current = window.setTimeout(() => void poll(probeId, generation, nextPollVersion), pollIntervalMs);
        setCancelBusy(false);
      }
    } catch (reason) {
      if (activeProbeRef.current !== probeId) return;
      setCancelBusy(false);
      setError(errorMessage(reason));
    }
  }

  const active = probe !== null && busy;
  const status = probe ? statusLabels[probe.status] ?? probe.status : "未运行";

  return <section className="probe-panel" aria-labelledby={headingId}>
    <div className="card-heading">
      <h4 id={headingId}>可用性探测</h4>
      <span className={`status-${statusTone(probe?.status ?? "idle")}`} role="status">{status}</span>
    </div>
    <div className="probe-controls">
      <label>超时（秒）
        <input aria-label="探测超时（秒）" disabled={busy} min="0.1" max="120" step="0.1" type="number" value={timeoutSeconds} onChange={(event) => setTimeoutSeconds(event.target.value)} />
      </label>
      <div className="probe-actions">
        <button disabled={busy || keys.length === 0} type="button" onClick={() => void start("keys", [])}>探测全部 Key</button>
        {active ? <button className="secondary-button" disabled={cancelBusy} type="button" onClick={() => void cancel()}>{cancelBusy ? "正在取消" : "取消探测"}</button> : null}
      </div>
    </div>
    {error ? <p className="service-action-error" role="alert">探测失败: {error}</p> : null}
    {probe?.error ? <p className="service-action-error" role="alert">探测任务失败: {probe.error}</p> : null}
    {probe?.results.length ? <ul className="probe-results">
      {probe.results.map((result, index) => <li key={`${result.key}-${result.endpoint}-${index}`}>
        <div><strong>{result.key}</strong><span>{safeEndpoint(result.endpoint)}</span></div>
        <div><span>{result.models.length ? result.models.join(", ") : "未发现模型"}</span><span>{result.latency_ms === null ? "延迟未知" : `${result.latency_ms} ms`}</span></div>
        {result.error ? <p className="service-action-error">{result.error}</p> : null}
      </li>)}
    </ul> : probe?.status === "complete" ? <p className="empty-state">没有返回可用端点结果。</p> : null}
  </section>;
}
