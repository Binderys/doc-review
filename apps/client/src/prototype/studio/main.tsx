import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { StudioApp } from "./StudioApp";
import { applyTheme, readStoredTheme } from "./theme";
import "./studio.css";

// Apply the persisted theme before first paint so the ground never flashes.
applyTheme(readStoredTheme());

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element #root was not found");
}

createRoot(root).render(
  <StrictMode>
    <StudioApp />
  </StrictMode>,
);
