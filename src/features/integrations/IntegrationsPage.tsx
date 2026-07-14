import { useEffect, useState } from "react";
import { configureAgentIntegration, getAgentIntegrationStatus, rollbackAgentIntegration, type AmkrIntegrationAgent, type AmkrIntegrationMode, type AmkrIntegrationStatus } from "../../api/amkr";

type IntegrationsPageProps = { configPath: string | null; baseUrl: string | null; authEnabled: boolean };

const agents: AmkrIntegrationAgent[] = ["claude-code", "codex"];

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

function statusText(status: AmkrIntegrationStatus | undefined) {
  if (!status) return "正在读取";
  if (status.current_is_applied) return `已接管 · ${status.mode ?? "未知模式"}`;
  if (status.backup_available) return "配置已变更 · 可回退";
  if (status.target_exists) return "检测到配置";
  return "未找到配置";
}

function previewFields(agent: AmkrIntegrationAgent, mode: AmkrIntegrationMode) {
  if (agent === "claude-code") return mode === "unified-model"
    ? ["env.ANTHROPIC_BASE_URL", "env.ANTHROPIC_AUTH_TOKEN", "env.ANTHROPIC_MODEL"]
    : ["env.ANTHROPIC_BASE_URL", "env.ANTHROPIC_AUTH_TOKEN"];
  return mode === "unified-model"
    ? ["model_provider", "model", "model_providers.OpenAI", "auth.json"]
    : ["model_provider", "model_providers.OpenAI", "auth.json"];
}

export function IntegrationsPage({ configPath, baseUrl, authEnabled }: IntegrationsPageProps) {
  const [statuses, setStatuses] = useState<Partial<Record<AmkrIntegrationAgent, AmkrIntegrationStatus>>>({});
  const [errors, setErrors] = useState<Partial<Record<AmkrIntegrationAgent, string>>>({});
  const [modes, setModes] = useState<Record<AmkrIntegrationAgent, AmkrIntegrationMode>>({ "claude-code": "unified-model", codex: "unified-model" });
  const [action, setAction] = useState<AmkrIntegrationAgent | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all(agents.map(async (agent) => {
      try {
        const status = await getAgentIntegrationStatus(agent);
        if (!cancelled) {
          setStatuses((current) => ({ ...current, [agent]: status }));
          if (status.mode === "native" || status.mode === "unified-model") setModes((current) => ({ ...current, [agent]: status.mode as AmkrIntegrationMode }));
        }
      } catch (reason) {
        if (!cancelled) setErrors((current) => ({ ...current, [agent]: errorMessage(reason) }));
      }
    }));
    return () => { cancelled = true; };
  }, []);

  async function apply(agent: AmkrIntegrationAgent) {
    setAction(agent); setErrors((current) => ({ ...current, [agent]: undefined }));
    try {
      const status = await configureAgentIntegration(configPath, agent, modes[agent]);
      setStatuses((current) => ({ ...current, [agent]: status }));
    } catch (reason) {
      setErrors((current) => ({ ...current, [agent]: errorMessage(reason) }));
    } finally { setAction(null); }
  }

  async function rollback(agent: AmkrIntegrationAgent) {
    if (!window.confirm(`回退 ${statuses[agent]?.display_name ?? agent} 的原配置？`)) return;
    setAction(agent); setErrors((current) => ({ ...current, [agent]: undefined }));
    try {
      const status = await rollbackAgentIntegration(agent);
      setStatuses((current) => ({ ...current, [agent]: status }));
    } catch (reason) {
      setErrors((current) => ({ ...current, [agent]: errorMessage(reason) }));
    } finally { setAction(null); }
  }

  return <section className="integrations-page" aria-labelledby="integrations-heading">
    <header className="page-header"><div><h2 id="integrations-heading">集成</h2><p>查看本机开发工具的配置发现状态。</p></div></header>
    <div className="integration-list">{agents.map((agent) => {
      const status = statuses[agent];
      const error = errors[agent];
      const fields = previewFields(agent, modes[agent]);
      return <article className="integration-item" key={agent}>
        <div className="integration-item-header">
          <div><h3>{status?.display_name ?? (agent === "claude-code" ? "Claude Code" : "Codex")}</h3><p>{status ? `目标文件 ${status.target_path}` : "正在读取配置状态。"}</p></div>
          <span className={status?.current_is_applied ? "status-good" : status?.backup_available || status?.target_exists ? "status-warn" : "status-muted"}>{error ? "操作失败" : statusText(status)}</span>
        </div>
        <div className="integration-controls">
          <label>路由模式<select disabled={action === agent} value={modes[agent]} onChange={(event) => setModes((current) => ({ ...current, [agent]: event.target.value as AmkrIntegrationMode }))}><option value="unified-model">统一模型</option><option value="native">原生模型</option></select></label>
          <button type="button" disabled={action !== null || !baseUrl || !authEnabled} onClick={() => void apply(agent)}>{action === agent ? "正在处理" : "应用"}</button>
          <button className="secondary-button" type="button" disabled={action !== null || !status?.backup_available} onClick={() => void rollback(agent)}>回退</button>
        </div>
        <details className="integration-fields">
          <summary>变更字段 · {fields.length} 项</summary>
          <div className="integration-field-list">{fields.map((field) => <code key={field}>{field}</code>)}</div>
        </details>
        {error ? <p className="service-action-error" role="alert">{error}</p> : null}
      </article>;
    })}</div>
    {baseUrl ? <p className="integration-note">目标地址 {baseUrl}。{authEnabled ? "本地鉴权已启用。" : "本地鉴权未启用。"}</p> : null}
  </section>;
}
