import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";

const preventDefault = (event: Event) => event.preventDefault();
const preventF12 = (event: KeyboardEvent) => { if (event.key === "F12") event.preventDefault(); };
document.addEventListener("contextmenu", preventDefault);
document.addEventListener("keydown", preventF12);
document.addEventListener("selectstart", preventDefault);

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
