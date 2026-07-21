// Theme is state, not identity (binderys DESIGN "Grounds"): the control that flips it
// never wears the signature, and the choice persists. Two verified grounds ship - a
// cool paper white and a slate ink; surfaces open on ink unless the visitor chooses.
export type StudioTheme = "paper" | "ink";

const STORAGE_KEY = "studio-theme";
const DEFAULT_THEME: StudioTheme = "ink";

function isTheme(value: string | null): value is StudioTheme {
  return value === "paper" || value === "ink";
}

export function readStoredTheme(): StudioTheme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyTheme(theme: StudioTheme): void {
  document.documentElement.setAttribute("data-studio-theme", theme);
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Best-effort chrome state; the root attribute is the source of truth this session.
  }
}
