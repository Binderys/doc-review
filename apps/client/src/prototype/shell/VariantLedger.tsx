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

// Variant B - Masthead ledger. One centred editorial column with generous phi rhythm.
// The Binding lays out inline as a thin thread-ruled ledger band; the document index is
// a horizontal folio strip; the authored document reads beneath. Reading-first: no
// persistent rail, the chrome yields to the document.
export function VariantLedger({
  surface,
  activePath,
  onSelect,
  theme,
  onThemeChange,
}: ShellProps) {
  const activeFile = surface.files.find((file) => file.path === activePath);

  return (
    <div className="es-shell">
      <div className="es-frame es-b">
        <Masthead theme={theme} onThemeChange={onThemeChange} />

        <BindingRecord surface={surface} orientation="inline" />

        <div className="es-b__reading">
          <ReadingHeader surface={surface} />
          <AgentSummary description={surface.description} />
        </div>

        <nav aria-label="Changed documents">
          <p className="es-section-label">
            Changed documents ({surface.files.length})
          </p>
          {surface.files.length === 0 ? (
            <p className="es-empty">No changed documents.</p>
          ) : (
            <ol className="es-b__index">
              {surface.files.map((file, index) => (
                <li key={file.path}>
                  <button
                    type="button"
                    className="es-doc"
                    aria-current={file.path === activePath ? "true" : undefined}
                    onClick={() => onSelect(file.path)}
                  >
                    <span className="es-doc__num">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="es-doc__role">{formatRole(file)}</span>
                    <span className="es-doc__name">{fileName(file.path)}</span>
                    <span className="es-doc__change">
                      {documentChangeSummary(file)}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </nav>

        <main className="es-b__reading">
          <ReadingPane file={activeFile} />
          <RetainedFeedback surface={surface} />
        </main>

        <div className="es-b__reading">
          <StateRoles />
        </div>
      </div>
    </div>
  );
}
