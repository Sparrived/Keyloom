import { useEffect, useState } from "react";

let nextNoticeId = 0;

export function useCopyToast() {
  const [notice, setNotice] = useState<{ id: number; message: string } | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 1_800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  return {
    showCopyToast: (message: string) => setNotice({ id: ++nextNoticeId, message }),
    copyToast: notice ? <div aria-atomic="true" aria-live="polite" className="copy-toast" key={notice.id} role="status">{notice.message}</div> : null,
  };
}
