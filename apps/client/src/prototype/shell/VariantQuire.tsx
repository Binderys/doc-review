import {
  AgentSummary,
  BindingRecord,
  fileName,
  formatRole,
  Masthead,
  RetainedFeedback,
  StateRoles,
} from "./chrome";
import { ReadingHeader, ReadingPane } from "./ReadingPane";
import type { ShellProps } from "./shellProps";

// Variant C - Split quire. The document set is a compact tab strip; below it the
// authored document canvas and its apparatus (Binding, agent summary, retained feedback,
// shell states) sit as two facing pages of an open section, the document taking the
// golden share. A working desk: document and evidence side by side, the densest shell.
export function VariantQuire({
  surface,
  activePath,
  onSelect,
  theme,
  onThemeChange,
}: ShellProps) {
  const activeFile = surface.files.find((file) => file.path === activePath);

  return (
    <div className="es-shell">
      <div className="es-frame es-frame--wide es-c">
        <Masthead theme={theme} onThemeChange={onThemeChange} />

        <nav className="es-c__tabs" aria-label="Changed documents">
          {surface.files.length === 0 ? (
            <p className="es-empty">No changed documents.</p>
          ) : (
            surface.files.map((file, index) => (
              <button
                key={file.path}
                type="button"
                className="es-c__tab"
                aria-current={file.path === activePath ? "true" : undefined}
                onClick={() => onSelect(file.path)}
              >
                <span className="es-c__tab-num">
                  {String(index + 1).padStart(2, "0")}
                </span>
                {fileName(file.path)}
                <span className="es-doc__role">{formatRole(file)}</span>
              </button>
            ))
          )}
        </nav>

        <div className="es-c__desk">
          <main className="es-c__canvas">
            <ReadingHeader surface={surface} />
            <ReadingPane file={activeFile} />
          </main>

          <aside className="es-c__apparatus" aria-label="Review apparatus">
            <BindingRecord surface={surface} orientation="stacked" />
            <AgentSummary description={surface.description} />
            <RetainedFeedback surface={surface} />
            <StateRoles />
          </aside>
        </div>
      </div>
    </div>
  );
}
