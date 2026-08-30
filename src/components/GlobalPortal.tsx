import { type ReactNode } from "react";
import { createPortal } from "react-dom";

type GlobalPortalProps = {
  children: ReactNode;
};

export function GlobalPortal({ children }: GlobalPortalProps) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}
