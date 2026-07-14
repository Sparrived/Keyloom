import { useEffect, useState } from "react";
import {
  exportAmkrConfig,
  checkAmkrUpdate,
  getAmkrProviders,
  getAmkrSettings,
  getRuntimeInstallationStatus,
  importAmkrConfig,
  regenerateAmkrLocalApiKey,
  rollbackPrivateRuntime,
  updateAmkrSettings,
  type AmkrHealth,
  type AmkrMetadata,
  type AmkrSettings,
  type AmkrSettingsResponse,
  type AmkrUpdateCheck,
  type RuntimeInstallationStatus,
} from "../../api/amkr";

type SettingsPageProps = {
  configPath: string | null;
  metadata: AmkrMetadata | null;
  health?: AmkrHealth | null;
  onConfigPathChange: (configPath: string | null) => void;
};

function formatNativeEndpointSummary(summary: AmkrHealth["native_endpoint_summary"]) {
  if (!summary) return "服务未提供";
  if (summary.supported + summary.fallback + summary.unknown === 0) return "尚无探测缓存";
  const parts = [`原生可用 ${summary.supported}`, `兼容回退 ${summary.fallback}`];
  if (summary.unknown > 0) parts.push(`未识别 ${summary.unknown}`);
  return parts.join(" · ");
}

export function SettingsPage({ configPath, metadata, health = null, onConfigPathChange }: SettingsPageProps) {
  const [draftConfigPath, setDraftConfigPath] = useState(configPath ?? metadata?.config_path ?? "");
  const [transfer, setTransfer] = useState("");
  const [transferAction, setTransferAction] = useState<"export" | "import" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeInstallationStatus | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(true);
  const [runtimeRollback, setRuntimeRollback] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [serviceSettings, setServiceSettings] = useState<AmkrSettingsResponse | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<AmkrSettings | null>(null);
  const [settingsAction, setSettingsAction] = useState<"save" | "key" | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const [generatedLocalKey, setGeneratedLocalKey] = useState<string | null>(null);
  const [updateCheck, setUpdateCheck] = useState<AmkrUpdateCheck | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  useEffect(() => setDraftConfigPath(configPath ?? metadata?.config_path ?? ""), [configPath, metadata?.config_path]);
  const refreshRuntimeStatus = async () => {
    setRuntimeLoading(true); setRuntimeError(null);
    try { setRuntimeStatus(await getRuntimeInstallationStatus()); }
    catch (reason) { setRuntimeError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setRuntimeLoading(false); }
  };
  useEffect(() => { void refreshRuntimeStatus(); }, []);
  useEffect(() => {
    let cancelled = false;
    setServiceSettings(null);
    setSettingsDraft(null);
    setGeneratedLocalKey(null);
    setSettingsError(null);
    if (!metadata) return () => { cancelled = true; };
    void (async () => {
      try {
        const result = await getAmkrSettings(configPath);
        if (!result?.settings) throw new Error("AMKR 未返回运行设置。");
        if (!cancelled) {
          setServiceSettings(result);
          setSettingsDraft(result.settings);
        }
      } catch (reason) {
        if (!cancelled) setSettingsError(reason instanceof Error ? reason.message : String(reason));
      }
    })();
    return () => { cancelled = true; };
  }, [configPath, metadata?.config_path]);
  const rollbackRuntime = async () => {
    if (!window.confirm("回退到上一个 Keyloom 私有运行时版本？")) return;
    setRuntimeRollback(true); setRuntimeError(null);
    try { setRuntimeStatus(await rollbackPrivateRuntime()); }
    catch (reason) { setRuntimeError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setRuntimeRollback(false); }
  };
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
  const saveSettings = async () => {
    if (!serviceSettings || !settingsDraft) return;
    const host = settingsDraft.host.trim();
    const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);
    if (!loopbackHosts.has(host.toLowerCase()) && !window.confirm("监听地址不是本机回环地址。远程客户端将可能访问 AMKR 管理 API，确定继续吗？")) return;
    if (host !== settingsDraft.host) setSettingsDraft({ ...settingsDraft, host });
    setSettingsAction("save"); setSettingsError(null); setSettingsNotice(null);
    try {
      const result = await updateAmkrSettings(serviceSettings.config_revision, { ...settingsDraft, host }, configPath);
      setServiceSettings(result);
      setSettingsDraft(result.settings);
      setSettingsNotice("运行设置已保存。监听地址变更将在服务重启后生效。");
    } catch (reason) {
      setSettingsError(reason instanceof Error ? reason.message : String(reason));
    } finally { setSettingsAction(null); }
  };
  const regenerateLocalKey = async () => {
    if (!serviceSettings || !window.confirm("重置本地鉴权 Key？现有客户端需要改用新 Key。")) return;
    setSettingsAction("key"); setSettingsError(null); setSettingsNotice(null); setGeneratedLocalKey(null);
    try {
      const result = await regenerateAmkrLocalApiKey(serviceSettings.config_revision, configPath);
      setGeneratedLocalKey(result.local_api_key);
      setServiceSettings((current) => current ? {
        ...current,
        config_revision: result.config_revision,
        settings: { ...current.settings, local_auth_enabled: true, local_api_key_fingerprint: result.local_api_key_fingerprint },
      } : current);
      setSettingsDraft((current) => current ? { ...current, local_auth_enabled: true, local_api_key_fingerprint: result.local_api_key_fingerprint } : current);
      setSettingsNotice("本地鉴权 Key 已重置，请立即更新客户端配置。");
    } catch (reason) {
      setSettingsError(reason instanceof Error ? reason.message : String(reason));
    } finally { setSettingsAction(null); }
  };
  const checkUpdate = async () => {
    setUpdateChecking(true); setUpdateError(null);
    try { setUpdateCheck(await checkAmkrUpdate(configPath)); }
    catch (reason) { setUpdateError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setUpdateChecking(false); }
  };
  return <section className="settings-page" aria-labelledby="settings-heading">
    <header className="page-header"><div><h2 id="settings-heading">设置</h2><p>当前 AMKR 实例的只读连接摘要。</p></div></header>
    <form className="config-path-form" onSubmit={(event) => { event.preventDefault(); onConfigPathChange(draftConfigPath.trim() || null); }}>
      <label>配置路径<input disabled={transferAction !== null} value={draftConfigPath} onChange={(event) => setDraftConfigPath(event.target.value)} placeholder="留空使用默认 AMKR 配置" /></label>
      <button type="submit" disabled={transferAction !== null}>使用配置</button>
    </form>
    {metadata ? <section className="runtime-panel" aria-labelledby="service-settings-heading">
      <div className="card-heading"><h3 id="service-settings-heading">AMKR 运行设置</h3><span className="config-revision">{serviceSettings ? serviceSettings.config_revision.slice(0, 8) : "正在读取"}</span></div>
      {settingsDraft ? <form className="inline-form" onSubmit={(event) => { event.preventDefault(); void saveSettings(); }}>
        <label>监听地址<input required value={settingsDraft.host} onChange={(event) => setSettingsDraft({ ...settingsDraft, host: event.target.value })} /></label>
        <label>端口<input required type="number" min="1" max="65535" value={settingsDraft.port} onChange={(event) => setSettingsDraft({ ...settingsDraft, port: Number(event.target.value) })} /></label>
        <label>请求超时<input required type="number" min="0.1" step="0.1" value={settingsDraft.request_timeout} onChange={(event) => setSettingsDraft({ ...settingsDraft, request_timeout: Number(event.target.value) })} /></label>
        <label>首字节超时<input required type="number" min="0.1" step="0.1" value={settingsDraft.stream_first_byte_timeout} onChange={(event) => setSettingsDraft({ ...settingsDraft, stream_first_byte_timeout: Number(event.target.value) })} /></label>
        <label>流式空闲超时<input required type="number" min="0.1" step="0.1" value={settingsDraft.stream_idle_timeout} onChange={(event) => setSettingsDraft({ ...settingsDraft, stream_idle_timeout: Number(event.target.value) })} /></label>
        <label>最大重试<input required type="number" min="0" step="1" value={settingsDraft.max_retries} onChange={(event) => setSettingsDraft({ ...settingsDraft, max_retries: Number(event.target.value) })} /></label>
        <button type="submit" disabled={settingsAction !== null}>{settingsAction === "save" ? "正在保存" : "保存设置"}</button>
      </form> : <p className="empty-state">运行设置暂不可用。</p>}
      <div className="local-key-row">
        <div><span>本地鉴权</span><strong>{serviceSettings?.settings.local_api_key_fingerprint ? `指纹 ${serviceSettings.settings.local_api_key_fingerprint}` : "未启用"}</strong></div>
        <button type="button" disabled={!serviceSettings || settingsAction !== null} onClick={() => void regenerateLocalKey()}>{settingsAction === "key" ? "正在重置" : "重置 Key"}</button>
      </div>
      {generatedLocalKey ? <div className="generated-key" role="status"><label>新 Key<input readOnly value={generatedLocalKey} /></label><button type="button" onClick={() => void navigator.clipboard.writeText(generatedLocalKey)}>复制</button></div> : null}
      {settingsNotice ? <p className="status-good" role="status">{settingsNotice}</p> : null}
      {settingsError ? <p className="service-action-error" role="alert">{settingsError}</p> : null}
    </section> : null}
    <section className="runtime-panel" aria-labelledby="runtime-heading">
      <div className="card-heading"><h3 id="runtime-heading">Keyloom 私有运行时</h3><div className="item-actions"><button type="button" disabled={runtimeLoading || runtimeRollback} onClick={() => void refreshRuntimeStatus()}>{runtimeLoading ? "正在检测" : "重新检测"}</button><button type="button" title={health?.status === "ok" ? "请先停止 AMKR 服务" : undefined} disabled={runtimeLoading || runtimeRollback || !runtimeStatus?.rollback_available || health?.status === "ok"} onClick={() => void rollbackRuntime()}>{runtimeRollback ? "正在回退" : "回退运行时"}</button></div></div>
      <dl className="settings-list">
        <div><dt>状态</dt><dd className={runtimeStatus?.private_runtime_installed ? "status-good" : runtimeStatus?.diagnostic || runtimeError ? "status-warn" : "status-muted"}>{runtimeError ? `操作失败: ${runtimeError}` : runtimeLoading && !runtimeStatus ? "正在检测" : runtimeStatus?.private_runtime_installed ? `已安装 · AMKR ${runtimeStatus.amkr_version ?? "未知版本"}` : runtimeStatus?.diagnostic ?? "未安装"}</dd></div>
        <div><dt>运行时目录</dt><dd>{runtimeStatus?.runtime_dir || "暂不可用"}</dd></div>
        <div><dt>Python</dt><dd>{runtimeStatus?.python_version ?? (runtimeStatus?.python_available ? "已发现" : "未安装")}</dd></div>
        <div><dt>AMKR wheel 校验</dt><dd>{runtimeStatus?.amkr_wheel_sha256 ? `${runtimeStatus.amkr_wheel_sha256.slice(0, 12)}…` : "暂不可用"}</dd></div>
      </dl>
    </section>
    {metadata ? <section className="runtime-panel" aria-labelledby="update-heading">
      <div className="card-heading"><h3 id="update-heading">版本更新</h3><button type="button" disabled={updateChecking} onClick={() => void checkUpdate()}>{updateChecking ? "正在检查" : "检查更新"}</button></div>
      {updateCheck ? <dl className="settings-list">
        <div><dt>当前版本</dt><dd>{updateCheck.current_version}</dd></div>
        <div><dt>最新版本</dt><dd className={updateCheck.update_available ? "status-warn" : "status-good"}>{updateCheck.latest_version ?? "暂不可用"}</dd></div>
        <div><dt>状态</dt><dd>{updateCheck.error ? `检查失败: ${updateCheck.error}` : updateCheck.update_available ? "发现新版本" : "当前已是最新版本"}</dd></div>
        {updateCheck.source ? <div><dt>来源</dt><dd>{updateCheck.source}</dd></div> : null}
        {updateCheck.release_url ? <div><dt>发布页面</dt><dd>{updateCheck.release_url}</dd></div> : null}
      </dl> : <p className="empty-state">尚未检查 AMKR 更新。</p>}
      {updateError ? <p className="service-action-error" role="alert">版本检查失败: {updateError}</p> : null}
    </section> : null}
    {!metadata ? <p className="empty-state">正在查找本机 AMKR 配置。</p> : <>
      <dl className="settings-list">
        <div><dt>服务地址</dt><dd>{metadata.base_url}</dd></div>
        <div><dt>AMKR 版本</dt><dd>{health?.version ?? runtimeStatus?.amkr_version ?? "暂不可用"}</dd></div>
        <div><dt>监听地址</dt><dd>{metadata.host && metadata.port ? `${metadata.host}:${metadata.port}` : "未读取"}</dd></div>
        <div><dt>配置文件</dt><dd>{metadata.config_path}</dd></div>
        <div><dt>本地鉴权</dt><dd>{metadata.auth_enabled ? "已启用" : "未启用"}</dd></div>
        <div><dt>本地 API Key 指纹</dt><dd>{health?.local_api_key_fingerprint ?? "暂不可用"}</dd></div>
        <div><dt>模型能力</dt><dd>{health?.models ? `已配置 ${health.models.length} 个模型` : "暂不可用"}</dd></div>
        <div><dt>原生端点缓存</dt><dd>{formatNativeEndpointSummary(health?.native_endpoint_summary)}</dd></div>
        <div><dt>访客访问</dt><dd>{health?.visitor_feature_installed ? `访客访问：${health.visitor_access_enabled ? "已启用" : "未启用"}（${health.visitor_key_count ?? 0} 个 Key）` : "功能未安装"}</dd></div>
        <div><dt>请求超时</dt><dd>{metadata.request_timeout == null ? "未配置" : `${metadata.request_timeout} 秒`}</dd></div>
        <div><dt>流式首字节超时</dt><dd>{metadata.stream_first_byte_timeout == null ? "未配置" : `${metadata.stream_first_byte_timeout} 秒`}</dd></div>
        <div><dt>流式空闲超时</dt><dd>{metadata.stream_idle_timeout == null ? "未配置" : `${metadata.stream_idle_timeout} 秒`}</dd></div>
        <div><dt>最大重试</dt><dd>{metadata.max_retries == null ? "未配置" : `${metadata.max_retries} 次`}</dd></div>
        <div><dt>指标数据库</dt><dd>{metadata.metrics_db_path ?? "未配置"}</dd></div>
        <div><dt>日志文件</dt><dd>{metadata.log_file_path ?? "未配置"}</dd></div>
      </dl>
      <section className="transfer-panel" aria-labelledby="transfer-heading"><div className="card-heading"><h3 id="transfer-heading">配置迁移</h3><button type="button" disabled={transferAction !== null} onClick={() => void exportConfig()}>{transferAction === "export" ? "正在导出" : "导出"}</button></div><textarea aria-label="可迁移配置" disabled={transferAction !== null} value={transfer} onChange={(event) => setTransfer(event.target.value)} placeholder="导出后在此显示，或粘贴可迁移配置以导入。" /><div className="transfer-actions"><button type="button" disabled={transferAction !== null || !transfer.trim()} onClick={() => void importConfig()}>{transferAction === "import" ? "正在导入" : "导入配置"}</button>{notice ? <span className="status-good">{notice}</span> : null}{error ? <span className="service-action-error">{error}</span> : null}</div></section>
    </>}
  </section>;
}
