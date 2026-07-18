import type {
  ChangedFileView,
  ReviewSurfaceResponse,
  SourceDiff,
} from "@doc-review/api-contracts";
import { ChangeChip, fileName } from "./chrome";

// The authored-document reading surface. This is deliberately constant across all three
// shells: the prototype restyles the chrome around the document, never the document
// itself, so the authored appearance is preserved while the shell is judged.

const SOURCE_MARKER: Record<SourceDiff[number]["change"], string> = {
  added: "+",
  removed: "−",
  context: " ",
};

// The PR-level reading header: the document-review eyebrow, the PR number in machine
// mono wearing the signature, the title, and the GitHub links.
export function ReadingHeader({ surface }: { surface: ReviewSurfaceResponse }) {
  return (
    <div>
      <p className="es-reading__eyebrow">Document review</p>
      <h1 className="es-reading__title">
        <span className="es-num">#{surface.number}</span> {surface.title}
      </h1>
      <div className="es-reading__links">
        <a href={surface.sourceBranchUrl}>Source branch</a>
        <a href={surface.githubUrl}>Open on GitHub</a>
      </div>
    </div>
  );
}

function SourceDiffTable({ sourceDiff }: { sourceDiff: SourceDiff }) {
  if (sourceDiff.length === 0) {
    return <p className="es-empty">No source lines to display.</p>;
  }
  return (
    <table className="es-diff">
      <tbody>
        {sourceDiff.map((line, index) => (
          <tr key={index} className={`es-diff__row--${line.change}`}>
            <td className="es-diff__num">{line.oldLine ?? ""}</td>
            <td className="es-diff__num">{line.newLine ?? ""}</td>
            <td className="es-diff__marker" aria-hidden="true">
              {SOURCE_MARKER[line.change]}
            </td>
            <td className="es-diff__text">{line.text}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DocumentBody({ file }: { file: ChangedFileView }) {
  const payload = file.payload;

  if (payload.format === "md") {
    return (
      <>
        <div
          className="es-prose"
          // Trusted, server-rendered Mirror HTML in production; a static fixture string
          // here. The shell never sanitizes because there is nothing untrusted to render.
          dangerouslySetInnerHTML={{ __html: payload.renderedHead }}
        />
        <details className="es-source">
          <summary>View source changes</summary>
          <div className="es-worddiff">
            {payload.diff.map((segment, index) => {
              if (segment.added) return <ins key={index}>{segment.value}</ins>;
              if (segment.removed)
                return <del key={index}>{segment.value}</del>;
              return <span key={index}>{segment.value}</span>;
            })}
          </div>
          <div className="es-source__frame">
            <SourceDiffTable sourceDiff={payload.sourceDiff} />
          </div>
        </details>
      </>
    );
  }

  if (payload.format === "docx") {
    return (
      <div
        className="es-prose"
        dangerouslySetInnerHTML={{ __html: payload.renderedHead }}
      />
    );
  }

  if (payload.format === "html") {
    // The sanitized, selectable semantics (the production HTML arm's safe copy). The
    // authored comparison iframe needs the server and is omitted from the offline shell.
    return (
      <>
        <div className="es-prose">
          {payload.reviewText.split("\n").map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>
        <details className="es-source">
          <summary>View source changes</summary>
          <div className="es-source__frame">
            <SourceDiffTable sourceDiff={payload.sourceDiff} />
          </div>
        </details>
      </>
    );
  }

  if (payload.format === "pdf") {
    return <p className="es-empty">PDF renders in the browser viewer.</p>;
  }

  return (
    <a className="es-reading__links" href={payload.blobUrl}>
      Download {payload.filename}
    </a>
  );
}

export function ReadingPane({ file }: { file: ChangedFileView | undefined }) {
  if (!file) return <p className="es-empty">No document selected.</p>;
  return (
    <article className="es-reading" aria-label={`Reviewing ${file.path}`}>
      <div className="es-doc-head">
        <ChangeChip changeType={file.changeType} />
        <span className="es-doc-head__path">{file.path}</span>
        <span className="es-doc__role">{fileName(file.path)}</span>
      </div>
      <DocumentBody file={file} />
    </article>
  );
}
