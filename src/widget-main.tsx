import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AmkrWidget } from "./widgets/AmkrWidget";
import "./styles/tokens.css";
import "./widgets/amkr-widget.css";

document.documentElement.classList.add("amkr-widget-document");
document.addEventListener("contextmenu", (event) => event.preventDefault());
document.addEventListener("keydown", (event) => { if (event.key === "F12") event.preventDefault(); });

createRoot(document.getElementById("root")!).render(<StrictMode><AmkrWidget /></StrictMode>);
