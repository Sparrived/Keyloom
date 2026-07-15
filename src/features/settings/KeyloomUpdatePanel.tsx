import { useEffect, useRef, useState } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import packageMetadata from "../../../package.json";

type UpdatePhase = "idle" | "checking" | "downloading" | "installing" | "restarting";

export function KeyloomUpdatePanel({ detectedVersion = null }: { detectedVersion?: string | null }) {
  const [update, setUpdate] = useState<Update | null>(null);
  const [checked, setChecked] = useState(false);
  const [phase, setPhase] = useState<UpdatePhase>("idle");
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
    if (!update || !window.confirm(`更新 Keyloom 到 ${update.version}？安装完成后应用将自动重启。`)) return;
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
    {phase === "downloading" || phase === "installing" ? <div className="update-progress" role="status">
      <progress aria-label="Keyloom 更新下载进度" max={100} value={progress ?? undefined} />
      <span>{phase === "installing" ? "正在安装" : progress == null ? "正在下载" : `正在下载 ${progress}%`}</span>
    </div> : null}
    {update ? <button type="button" disabled={busy} onClick={() => void installUpdate()}>{phase === "restarting" ? "正在重启 Keyloom" : busy ? "正在更新" : "下载并安装"}</button> : null}
    {error ? <p className="service-action-error" role="alert">Keyloom 更新失败: {error}</p> : null}
  </section>;
}
