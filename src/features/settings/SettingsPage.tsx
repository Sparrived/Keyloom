import { useEffect, useState } from "react";
import { exportAmkrConfig, getAmkrProviders, importAmkrConfig, type AmkrMetadata } from "../../api/amkr";

type SettingsPageProps = {
  configPath: string | null;
  metadata: AmkrMetadata | null;
  onConfigPathChange: (configPath: string | null) => void;
};

export function SettingsPage({ configPath, metadata, onConfigPathChange }: SettingsPageProps) {
  const [draftConfigPath, setDraftConfigPath] = useState(configPath ?? metadata?.config_path ?? "");
  const [transfer, setTransfer] = useState("");
  const [transferAction, setTransferAction] = useState<"export" | "import" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraftConfigPath(configPath ?? metadata?.config_path ?? ""), [configPath, metadata?.config_path]);
  const exportConfig = async () => {
    setTransferAction("export"); setNotice(null); setError(null);
    try { const result = await exportAmkrConfig(configPath); setTransfer(JSON.stringify(result.config, null, 2)); setNotice("已导出可迁移配置。"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setTransferAction(null); }
  };
  const importConfig = async () => {
    if (!transfer.trim() || !window.confirm("导入将替换供应商与路由配置。是否继续？")) return;
    setTransferAction("import"); setNotice(null); setError(null);
    try {
      const parsed: unknown = JSON.parse(transfer);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("配置内容必须是 JSON 对象。");
      const latest = await getAmkrProviders(configPath);
      const result = await importAmkrConfig(latest.config_revision, parsed as Record<string, unknown>, configPath);
      if (!result.imported) throw new Error("AMKR 未确认配置导入。");
      setNotice("配置已导入，AMKR 已热重载。");
    } catch (reason) {
      setError(reason instanceof SyntaxError ? "配置内容不是有效 JSON。" : reason instanceof Error ? reason.message : String(reason));
    } finally {
      setTransferAction(null);
    }
  };
  return <section className="settings-page" aria-labelledby="settings-heading">
    <header className="page-header"><div><h2 id="settings-heading">设置</h2><p>当前 AMKR 实例的只读连接摘要。</p></div></header>
    <form className="config-path-form" onSubmit={(event) => { event.preventDefault(); onConfigPathChange(draftConfigPath.trim() || null); }}>
      <label>配置路径<input disabled={transferAction !== null} value={draftConfigPath} onChange={(event) => setDraftConfigPath(event.target.value)} placeholder="留空使用默认 AMKR 配置" /></label>
      <button type="submit" disabled={transferAction !== null}>使用配置</button>
    </form>
    {!metadata ? <p className="empty-state">正在查找本机 AMKR 配置。</p> : <><dl className="settings-list"><div><dt>服务地址</dt><dd>{metadata.base_url}</dd></div><div><dt>配置文件</dt><dd>{metadata.config_path}</dd></div><div><dt>本地鉴权</dt><dd>{metadata.auth_enabled ? "已启用" : "未启用"}</dd></div><div><dt>指标数据库</dt><dd>{metadata.metrics_db_path ?? "未配置"}</dd></div><div><dt>日志文件</dt><dd>{metadata.log_file_path ?? "未配置"}</dd></div></dl><section className="transfer-panel" aria-labelledby="transfer-heading"><div className="card-heading"><h3 id="transfer-heading">配置迁移</h3><button type="button" disabled={transferAction !== null} onClick={() => void exportConfig()}>{transferAction === "export" ? "正在导出" : "导出"}</button></div><textarea aria-label="可迁移配置" disabled={transferAction !== null} value={transfer} onChange={(event) => setTransfer(event.target.value)} placeholder="导出后在此显示，或粘贴可迁移配置以导入。" /><div className="transfer-actions"><button type="button" disabled={transferAction !== null || !transfer.trim()} onClick={() => void importConfig()}>{transferAction === "import" ? "正在导入" : "导入配置"}</button>{notice ? <span className="status-good">{notice}</span> : null}{error ? <span className="service-action-error">{error}</span> : null}</div></section></>}
  </section>;
}
