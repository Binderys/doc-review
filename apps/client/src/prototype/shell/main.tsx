import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PrototypeShellApp } from "./PrototypeShellApp";
import { applyTheme, readStoredTheme } from "./shellTheme";
import "./shell.css";

// Apply the persisted theme before the first paint so the ground never flashes.
applyTheme(readStoredTheme());

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element #root was not found");
}

createRoot(root).render(
  <StrictMode>
    <PrototypeShellApp />
  </StrictMode>,
);
