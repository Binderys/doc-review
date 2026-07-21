import { useEffect, useState } from "react";
import { Mark } from "./Mark";
import { applyTheme, readStoredTheme, type Theme } from "./theme";

// The Paper/Ink control wears the muted role, never the signature (theme is state,
// binderys DESIGN "Grounds"). It reads and writes the persisted ground and reflects
// the choice onto the document root, so a reload opens on the chosen ground.
function ThemeControl() {
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return (
    <div className="masthead__theme" role="group" aria-label="Ground">
      {(["paper", "ink"] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={theme === option}
          onClick={() => setTheme(option)}
        >
          {option === "paper" ? "Paper" : "Ink"}
        </button>
      ))}
    </div>
  );
}

// The site masthead: the binderys lockup (home), the sibling identity
// `folio 01 - Doc Review`, an optional crumb for the current review, and the muted
// Paper/Ink ground control. The lockup links home with a real href so it works
// without JavaScript and the browser owns navigation.
export function Masthead({ crumb }: { crumb?: string }) {
  return (
    <header className="masthead">
      <a className="masthead__lockup" href="/">
        <Mark className="masthead__mark" />
        <span className="masthead__wordmark">binderys</span>
      </a>
      <span className="masthead__sibling">
        <span className="masthead__folio">folio 01</span>
        <span className="masthead__sibling-name">Doc Review</span>
      </span>
      {crumb ? <span className="masthead__crumb">{crumb}</span> : null}
      <span className="masthead__spacer" />
      <ThemeControl />
    </header>
  );
}
