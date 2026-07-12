import { useEffect, useRef, useState } from "react";
import {
  cancelAmkrProbe,
  getAmkrProbe,
  probeAmkrKeys,
  probeAmkrPools,
  type AmkrProbe,
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
    return value.replace(/\/\/[^/@\s]+@/, "//").split(/[?#]/, 1)[0];
  }
}

function statusTone(status: string) {
  if (status === "complete") return "good";
  if (status === "failed") return "bad";
  if (status === "cancelled") return "warn";
  return "muted";
}

export function ProbePanel({ configPath, providerId, keys, pools }: ProbePanelProps) {
  const [timeoutSeconds, setTimeoutSeconds] = useState("15");
  const [probe, setProbe] = useState<AmkrProbe | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const generationRef = useRef(0);
  const pollVersionRef = useRef(0);
  const activeProbeRef = useRef<string | null>(null);

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
      if (probeId) void cancelAmkrProbe(probeId, configPath).catch(() => undefined);
    };
  }, [configPath]);

  async function poll(probeId: string, generation: number, pollVersion: number) {
    try {
      const result = await getAmkrProbe(probeId, configPath);
      if (generationRef.current !== generation || pollVersionRef.current !== pollVersion || activeProbeRef.current !== probeId) return;
      setProbe(result);
      if (terminalStatuses.has(result.status)) {
        activeProbeRef.current = null;
        setBusy(false);
        setCancelBusy(false);
        clearTimer();
      } else {
        timerRef.current = window.setTimeout(() => void poll(probeId, generation, pollVersion), pollIntervalMs);
      }
    } catch (reason) {
      if (generationRef.current !== generation || pollVersionRef.current !== pollVersion || activeProbeRef.current !== probeId) return;
      activeProbeRef.current = null;
      setBusy(false);
      setCancelBusy(false);
      setError(errorMessage(reason));
      clearTimer();
    }
  }

  async function start(kind: "keys" | "pools", selected: string[]) {
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
    setBusy(true);
    setCancelBusy(false);
    setError(null);
    setProbe(null);
    try {
      const started = kind === "keys"
        ? await probeAmkrKeys(providerId, selected, timeout, configPath)
        : await probeAmkrPools(providerId, selected, timeout, configPath);
      if (generationRef.current !== generation) return;
      activeProbeRef.current = started.probe_id;
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

  return <section className="probe-panel" aria-labelledby={`probe-heading-${providerId}`}>
    <div className="card-heading">
      <h4 id={`probe-heading-${providerId}`}>可用性探测</h4>
      <span className={`status-${statusTone(probe?.status ?? "idle")}`} role="status">{status}</span>
    </div>
    <div className="probe-controls">
      <label>超时（秒）
        <input aria-label="探测超时（秒）" disabled={busy} min="0.1" max="120" step="0.1" type="number" value={timeoutSeconds} onChange={(event) => setTimeoutSeconds(event.target.value)} />
      </label>
      <div className="probe-actions">
        <button disabled={busy || keys.length === 0} type="button" onClick={() => void start("keys", [])}>探测全部 Key</button>
        <button disabled={busy || pools.length === 0} type="button" onClick={() => void start("pools", [])}>探测全部模型池</button>
        {keys.map((key) => <button key={`key-${key}`} disabled={busy} type="button" onClick={() => void start("keys", [key])}>探测 Key {key}</button>)}
        {pools.map((pool) => <button key={`pool-${pool}`} disabled={busy} type="button" onClick={() => void start("pools", [pool])}>探测模型池 {pool}</button>)}
        {active ? <button className="secondary-button" disabled={cancelBusy} type="button" onClick={() => void cancel()}>{cancelBusy ? "正在取消" : "取消探测"}</button> : null}
      </div>
    </div>
    {error ? <p className="service-action-error">探测失败: {error}</p> : null}
    {probe?.error ? <p className="service-action-error">探测任务失败: {probe.error}</p> : null}
    {probe?.results.length ? <ul className="probe-results">
      {probe.results.map((result, index) => <li key={`${result.key}-${result.endpoint}-${index}`}>
        <div><strong>{result.key}</strong><span>{safeEndpoint(result.endpoint)}</span></div>
        <div><span>{result.models.length ? result.models.join(", ") : "未发现模型"}</span><span>{result.latency_ms === null ? "延迟未知" : `${result.latency_ms} ms`}</span></div>
        {result.error ? <p className="service-action-error">{result.error}</p> : null}
      </li>)}
    </ul> : probe?.status === "complete" ? <p className="empty-state">没有返回可用端点结果。</p> : null}
  </section>;
}
