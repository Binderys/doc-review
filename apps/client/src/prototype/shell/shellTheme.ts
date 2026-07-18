// The two verified grounds the editorial system ships (DESIGN.md "Grounds"): a cool
// paper white and a slate ink. Theme is state, not identity, so the control that flips
// it never wears the signature and the choice persists across shell variants.
export type ShellTheme = "paper" | "ink";

const STORAGE_KEY = "es-shell-theme";

// Surfaces open on ink unless the visitor has chosen otherwise (DESIGN "Layout posture").
const DEFAULT_THEME: ShellTheme = "ink";

function isTheme(value: string | null): value is ShellTheme {
  return value === "paper" || value === "ink";
}

export function readStoredTheme(): ShellTheme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

// Applies the theme to the document root (the tokens key off `data-shell-theme`) and
// remembers the choice. Persistence is best-effort chrome state, so a storage failure
// is swallowed rather than surfaced.
export function applyTheme(theme: ShellTheme): void {
  document.documentElement.setAttribute("data-shell-theme", theme);
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Best-effort only; the in-memory attribute is the source of truth this session.
  }
}
