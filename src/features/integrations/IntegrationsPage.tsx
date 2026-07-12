import { useEffect, useState } from "react";
import { getAgentIntegrationStatus, type AmkrIntegrationAgent, type AmkrIntegrationStatus } from "../../api/amkr";

type IntegrationsPageProps = { baseUrl: string | null; authEnabled: boolean };

const agents: AmkrIntegrationAgent[] = ["claude-code", "codex"];

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

function statusText(status: AmkrIntegrationStatus | undefined) {
  if (!status) return "正在读取";
  if (status.backup_available) return `已接管 · ${status.mode ?? "未知模式"}`;
  if (status.target_exists) return "检测到配置";
  return "未找到配置";
}

export function IntegrationsPage({ baseUrl, authEnabled }: IntegrationsPageProps) {
  const [statuses, setStatuses] = useState<Partial<Record<AmkrIntegrationAgent, AmkrIntegrationStatus>>>({});
  const [errors, setErrors] = useState<Partial<Record<AmkrIntegrationAgent, string>>>({});

  useEffect(() => {
    let cancelled = false;
    void Promise.all(agents.map(async (agent) => {
      try {
        const status = await getAgentIntegrationStatus(agent);
        if (!cancelled) setStatuses((current) => ({ ...current, [agent]: status }));
      } catch (reason) {
        if (!cancelled) setErrors((current) => ({ ...current, [agent]: errorMessage(reason) }));
      }
    }));
    return () => { cancelled = true; };
  }, []);

  return <section className="integrations-page" aria-labelledby="integrations-heading">
    <header className="page-header"><div><h2 id="integrations-heading">集成</h2><p>查看本机开发工具的配置发现状态。</p></div></header>
    <div className="integration-list">{agents.map((agent) => {
      const status = statuses[agent];
      const error = errors[agent];
      return <article className="integration-item" key={agent}>
        <div>
          <h3>{status?.display_name ?? (agent === "claude-code" ? "Claude Code" : "Codex")}</h3>
          <p>{error ? `无法读取: ${error}` : status ? `目标文件 ${status.target_path}` : "正在读取配置状态。"}</p>
        </div>
        <span className={status?.backup_available ? "status-good" : status?.target_exists ? "status-warn" : "status-muted"}>{error ? "无法读取" : statusText(status)}</span>
      </article>;
    })}</div>
    {baseUrl ? <p className="integration-note">目标地址 {baseUrl}。{authEnabled ? "本地鉴权已启用。" : "本地鉴权未启用。"}</p> : null}
  </section>;
}
