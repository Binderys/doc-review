import { useEffect } from "react";

export type ShellOption = { key: string; name: string };

// The floating prototype control: prev / label / next, cycling the shell variants. It is
// deliberately high-contrast scaffolding, not part of the design under evaluation. Both
// clicks and the left/right arrow keys cycle (skipping when a text field is focused), the
// label announces the current shell, and the whole bar is hidden in production builds so a
// stray merge cannot ship it.
export function ShellBar({
  options,
  current,
  onChange,
}: {
  options: ShellOption[];
  current: string;
  onChange: (key: string) => void;
}) {
  const index = Math.max(
    0,
    options.findIndex((option) => option.key === current),
  );

  const step = (delta: number): void => {
    const next = (index + delta + options.length) % options.length;
    onChange(options[next].key);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) {
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        step(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        step(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!import.meta.env.DEV) return null;

  const active = options[index];

  return (
    <div className="es-bar" role="group" aria-label="Prototype shell selector">
      <button
        type="button"
        aria-label="Previous shell"
        onClick={() => step(-1)}
      >
        {"‹"}
      </button>
      <span className="es-bar__label" aria-live="polite">
        {active.key} - {active.name}
        <small>?variant={active.key}</small>
      </span>
      <button type="button" aria-label="Next shell" onClick={() => step(1)}>
        {"›"}
      </button>
    </div>
  );
}
