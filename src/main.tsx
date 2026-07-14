import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";

const preventDefault = (event: Event) => event.preventDefault();
document.addEventListener("contextmenu", preventDefault);
document.addEventListener("selectstart", preventDefault);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
