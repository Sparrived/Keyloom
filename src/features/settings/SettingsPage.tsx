import { useState } from "react";
import { exportAmkrConfig, importAmkrConfig, type AmkrMetadata } from "../../api/amkr";

type SettingsPageProps = { metadata: AmkrMetadata | null };

export function SettingsPage({ metadata }: SettingsPageProps) {
  const [transfer, setTransfer] = useState("");
  const [revision, setRevision] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const exportConfig = async () => { try { const result = await exportAmkrConfig(); setTransfer(JSON.stringify(result.config, null, 2)); setRevision(result.config_revision); setNotice("已导出可迁移配置。"); setError(null); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } };
  const importConfig = async () => { if (!revision || !window.confirm("导入将替换供应商与路由配置。是否继续？")) return; try { const config: unknown = JSON.parse(transfer); const result = await importAmkrConfig(revision, config); setRevision(result.config_revision); setNotice("配置已导入，AMKR 已热重载。"); setError(null); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } };
  return <section className="settings-page" aria-labelledby="settings-heading">
    <header className="page-header"><div><h2 id="settings-heading">设置</h2><p>当前 AMKR 实例的只读连接摘要。</p></div></header>
    {!metadata ? <p className="empty-state">正在查找本机 AMKR 配置。</p> : <><dl className="settings-list"><div><dt>服务地址</dt><dd>{metadata.base_url}</dd></div><div><dt>配置文件</dt><dd>{metadata.config_path}</dd></div><div><dt>本地鉴权</dt><dd>{metadata.auth_enabled ? "已启用" : "未启用"}</dd></div><div><dt>指标数据库</dt><dd>{metadata.metrics_db_path ?? "未配置"}</dd></div><div><dt>日志文件</dt><dd>{metadata.log_file_path ?? "未配置"}</dd></div></dl><section className="transfer-panel" aria-labelledby="transfer-heading"><div className="card-heading"><h3 id="transfer-heading">配置迁移</h3><button type="button" onClick={() => void exportConfig()}>导出</button></div><textarea aria-label="可迁移配置" value={transfer} onChange={(event) => setTransfer(event.target.value)} placeholder="导出后在此显示，或粘贴可迁移配置以导入。" /><div className="transfer-actions"><button type="button" disabled={!revision || !transfer.trim()} onClick={() => void importConfig()}>导入配置</button>{notice ? <span className="status-good">{notice}</span> : null}{error ? <span className="service-action-error">{error}</span> : null}</div></section></>}
  </section>;
}
