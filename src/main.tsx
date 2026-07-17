import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";

const preventDefault = (event: Event) => {
  if (event.type === "contextmenu" && event.target instanceof Element && event.target.closest(".log-panel pre")) return;
  event.preventDefault();
};
const preventF12 = (event: KeyboardEvent) => { if (event.key === "F12") event.preventDefault(); };
document.addEventListener("contextmenu", preventDefault);
document.addEventListener("keydown", preventF12);

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
