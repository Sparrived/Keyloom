import { useEffect, useRef, useState } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import packageMetadata from "../../../package.json";

type UpdatePhase = "idle" | "checking" | "downloading" | "installing" | "restarting";

export function KeyloomUpdatePanel({ detectedVersion = null }: { detectedVersion?: string | null }) {
  const [update, setUpdate] = useState<Update | null>(null);
  const [checked, setChecked] = useState(false);
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [downloaded, setDownloaded] = useState(0);
  const [downloadSize, setDownloadSize] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const checkingRef = useRef(false);

  useEffect(() => () => { void update?.close(); }, [update]);

  const checkForUpdate = async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    setPhase("checking");
    setError(null);
    setDownloaded(0);
    setDownloadSize(null);
    setDialogOpen(false);
    setUpdate(null);
    try {
      setUpdate(await check({ timeout: 15_000 }));
      setChecked(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      checkingRef.current = false;
      setPhase("idle");
    }
  };

  useEffect(() => {
    if (detectedVersion) void checkForUpdate();
  }, [detectedVersion]);

  const handleDownload = (event: DownloadEvent) => {
    if (event.event === "Started") {
      setDownloadSize(event.data.contentLength ?? null);
      setDownloaded(0);
    } else if (event.event === "Progress") {
      setDownloaded((current) => current + event.data.chunkLength);
    } else {
      setPhase("installing");
    }
  };

  const installUpdate = async () => {
    if (!update) return;
    setPhase("downloading");
    setError(null);
    try {
      await update.downloadAndInstall(handleDownload, { timeout: 300_000 });
      setPhase("restarting");
      await relaunch();
    } catch (reason) {
      setPhase("idle");
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const busy = phase !== "idle";
  const progress = downloadSize ? Math.min(100, Math.round((downloaded / downloadSize) * 100)) : null;
  const availableVersion = update?.version ?? detectedVersion;
  const dialogBusy = phase === "downloading" || phase === "installing" || phase === "restarting";
  const dialogTitle = phase === "downloading"
    ? "正在下载 Keyloom 更新"
    : phase === "installing"
      ? "正在安装 Keyloom 更新"
      : phase === "restarting"
        ? "正在重启 Keyloom"
        : error
          ? "Keyloom 更新失败"
          : "安装 Keyloom 更新？";

  return <section className="runtime-panel" id="keyloom-update-panel" aria-labelledby="keyloom-update-heading">
    <div className="card-heading">
      <h3 id="keyloom-update-heading">Keyloom 更新</h3>
      <button type="button" disabled={busy} onClick={() => void checkForUpdate()}>{phase === "checking" ? "正在检查" : "检查 Keyloom 更新"}</button>
    </div>
    <dl className="settings-list">
      <div><dt>当前版本</dt><dd>{packageMetadata.version}</dd></div>
      <div><dt>最新版本</dt><dd className={availableVersion ? "status-warn" : checked ? "status-good" : "status-muted"}>{availableVersion ?? (checked ? packageMetadata.version : "尚未检查")}</dd></div>
      <div><dt>状态</dt><dd>{availableVersion ? "发现新版本" : checked ? "当前已是最新版本" : "等待检查"}</dd></div>
    </dl>
    {update?.body ? <p className="update-notes">{update.body}</p> : null}
    {update ? <button type="button" disabled={busy} onClick={() => setDialogOpen(true)}>{phase === "restarting" ? "正在重启 Keyloom" : busy ? "正在更新" : "下载并安装"}</button> : null}
    {error ? <p className="service-action-error" role="alert">Keyloom 更新失败: {error}</p> : null}
    {dialogOpen && update ? <div className="close-dialog-backdrop" onKeyDown={(event) => { if (event.key === "Escape" && !dialogBusy) setDialogOpen(false); }}>
      <section aria-labelledby="keyloom-update-dialog-heading" aria-modal="true" className="close-dialog update-dialog" role="dialog">
        <h2 id="keyloom-update-dialog-heading">{dialogTitle}</h2>
        <p>Keyloom {packageMetadata.version} → {update.version}。安装完成后应用将自动重启。</p>
        {update.body ? <p className="update-notes">{update.body}</p> : null}
        {phase === "downloading" || phase === "installing" ? <div className="update-progress" role="status">
          <progress aria-label="Keyloom 更新下载进度" max={100} value={progress ?? undefined} />
          <span>{phase === "installing" ? "正在安装" : progress == null ? "正在下载" : `正在下载 ${progress}%`}</span>
        </div> : null}
        {phase === "restarting" ? <p className="update-dialog-status" role="status">正在重启 Keyloom</p> : null}
        {error ? <p className="service-action-error" role="alert">{error}</p> : null}
        <div className="close-dialog-actions">
          <button autoFocus className="secondary-button" disabled={dialogBusy} type="button" onClick={() => setDialogOpen(false)}>取消</button>
          <button className="tray-action" disabled={dialogBusy} type="button" onClick={() => void installUpdate()}>{error ? "重试" : "下载并安装"}</button>
        </div>
      </section>
    </div> : null}
  </section>;
}
