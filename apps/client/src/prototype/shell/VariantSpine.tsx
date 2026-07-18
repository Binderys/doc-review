import {
  AgentSummary,
  BindingRecord,
  documentChangeSummary,
  fileName,
  formatRole,
  Masthead,
  RetainedFeedback,
  StateRoles,
} from "./chrome";
import { ReadingHeader, ReadingPane } from "./ReadingPane";
import type { ShellProps } from "./shellProps";

// Variant A - Codex spine. A persistent left binding rail (the Binding record, the
// folio-numbered document index, the shell states) sewn to the reading column by a
// dashed thread rule. Navigation-first: the spine is the primary affordance, the
// authored document reads to its right and opens wide media toward the phi container.
export function VariantSpine({
  surface,
  activePath,
  onSelect,
  theme,
  onThemeChange,
}: ShellProps) {
  const activeFile = surface.files.find((file) => file.path === activePath);

  return (
    <div className="es-shell">
      <div className="es-frame es-frame--wide es-a">
        <Masthead theme={theme} onThemeChange={onThemeChange} />

        <div className="es-a__body">
          <aside className="es-a__spine" aria-label="Review spine">
            <BindingRecord surface={surface} orientation="stacked" />

            <nav aria-label="Changed documents">
              <p className="es-section-label">
                Changed documents ({surface.files.length})
              </p>
              {surface.files.length === 0 ? (
                <p className="es-empty">No changed documents.</p>
              ) : (
                <ol className="es-a__index">
                  {surface.files.map((file, index) => (
                    <li key={file.path}>
                      <button
                        type="button"
                        className="es-doc"
                        aria-current={
                          file.path === activePath ? "true" : undefined
                        }
                        onClick={() => onSelect(file.path)}
                      >
                        <span className="es-doc__num">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span className="es-doc__role">{formatRole(file)}</span>
                        <span className="es-doc__name">
                          {fileName(file.path)}
                        </span>
                        <span className="es-doc__change">
                          {documentChangeSummary(file)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </nav>

            <StateRoles />
          </aside>

          <main className="es-a__reading">
            <ReadingHeader surface={surface} />
            <AgentSummary description={surface.description} />
            <ReadingPane file={activeFile} />
            <RetainedFeedback surface={surface} />
          </main>
        </div>
      </div>
    </div>
  );
}
