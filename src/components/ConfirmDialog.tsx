import { useCallback, useRef, useState, type ReactNode } from "react";

type ConfirmOptions = { message: string; title?: string; confirmLabel?: string; danger?: boolean };
type PendingConfirm = ConfirmOptions & { resolve: (value: boolean) => void };

export function useConfirmDialog() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const pendingRef = useRef<PendingConfirm | null>(null);
  const confirm = useCallback((options: ConfirmOptions | string) => {
    const next = typeof options === "string" ? { message: options } : options;
    pendingRef.current?.resolve(false);
    return new Promise<boolean>((resolve) => {
      const value = { ...next, resolve };
      pendingRef.current = value;
      setPending(value);
    });
  }, []);
  const close = useCallback((result: boolean) => {
    pendingRef.current?.resolve(result);
    pendingRef.current = null;
    setPending(null);
  }, []);
  const dialog: ReactNode = pending ? <div className="close-dialog-backdrop" onKeyDown={(event) => { if (event.key === "Escape") close(false); }}>
    <section aria-labelledby="confirm-dialog-heading" aria-modal="true" className="close-dialog" role="dialog">
      <h2 id="confirm-dialog-heading">{pending.title ?? "请确认"}</h2>
      <p>{pending.message}</p>
      <div className="close-dialog-actions">
        <button autoFocus className="secondary-button" type="button" onClick={() => close(false)}>取消</button>
        <button className={pending.danger ? "danger-button" : "tray-action"} type="button" onClick={() => close(true)}>{pending.confirmLabel ?? "确认"}</button>
      </div>
    </section>
  </div> : null;
  return { confirm, dialog };
}
