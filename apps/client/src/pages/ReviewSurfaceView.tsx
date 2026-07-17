import type {
  ChangedFileView,
  FeedbackAnchor,
  FilePayload,
  ReviewComment,
  ReviewRound,
  ReviewSurfaceResponse,
  SourceDiff,
} from "@doc-review/api-contracts";
import { useState, type FormEvent, type ReactElement } from "react";
import type { RenderedAnnotatorFactory } from "../features/annotation/renderedAnnotator";
import { RenderedAnnotationSurface } from "../features/annotation/RenderedAnnotationSurface";
import { SanitizedHtmlSurface } from "../features/annotation/SanitizedHtmlSurface";
import { resolveApiResourceUrl } from "../shared/api";

const CHANGE_MARKER: Record<ChangedFileView["changeType"], string> = {
  added: "Added",
  modified: "Modified",
  deleted: "Deleted",
};

type ReviewMode = "evidence" | "guided";

const FORMAT_LABEL: Record<FilePayload["format"], string> = {
  download: "Supporting file",
  md: "Mirror",
  docx: "Canonical",
  html: "HTML document",
  pdf: "PDF document",
};

function fileName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function documentChangeSummary(file: ChangedFileView): string {
  const payload = file.payload;
  if ("sourceDiff" in payload) {
    const added = payload.sourceDiff.filter(
      (line) => line.change === "added",
    ).length;
    const removed = payload.sourceDiff.filter(
      (line) => line.change === "removed",
    ).length;
    if (added > 0 || removed > 0) {
      return `${added} ${added === 1 ? "line" : "lines"} added, ${removed} removed`;
    }
  }

  return `${CHANGE_MARKER[file.changeType]} ${FORMAT_LABEL[payload.format].toLowerCase()}`;
}

function agentSummaryItems(description: string): string[] {
  const lines = description
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const isHeading = (line: string): boolean => /^#{1,6}\s/.test(line);
  const stripMarker = (line: string): string =>
    line.replace(/^(?:#{1,6}\s+|[-*+]\s+|\d+\.\s+)/, "");

  // A heading is a section label, not a change item, so prefer body and list lines.
  // But a headings-only description still carries the summary: fall back to the
  // heading text (marker syntax dropped) rather than reporting no summary at all.
  const body = lines.filter((line) => !isHeading(line));
  const source = body.length > 0 ? body : lines;

  return source
    .map(stripMarker)
    .filter((line) => line.length > 0)
    .slice(0, 3)
    .map((line) => (line.length > 180 ? `${line.slice(0, 177)}...` : line));
}

// The unified-diff change marker for each source line: `+` added, `-` removed, a
// space for unchanged context - the standard textual cue, so the change is legible
// even before CSS distinguishes the rows.
const SOURCE_CHANGE_MARKER: Record<SourceDiff[number]["change"], string> = {
  added: "+",
  removed: "-",
  context: " ",
};

type SourceSelection = {
  startLine: number;
  endLine: number;
  quote: string;
  phase: "pending" | "complete";
  revision: number;
};

type SelectSourceLine = (line: number) => void;

// Per-document draft state, lifted to the parent and keyed by document path so it
// outlives the unmount/remount of a single document's review pane (#57). `selection`
// is the chosen source range; `fields` are the feedback form's current values (a
// selection-seeded anchor field the reviewer may then edit, plus the unsubmitted body).
type DraftFields = Record<string, string>;

type DocumentDraft = {
  selection: SourceSelection | null;
  fields: DraftFields;
};

const EMPTY_DRAFT: DocumentDraft = { selection: null, fields: {} };

// The form fields a fresh source selection seeds, by payload format: a new selection
// overwrites its anchor fields (start/end/quote for the Mirror range, line/quote for
// the HTML line) while the unsubmitted feedback body is left untouched.
function selectionSeededFields(
  format: FilePayload["format"],
  selection: SourceSelection,
): DraftFields {
  if (format === "md") {
    return {
      startLine: String(selection.startLine),
      endLine: String(selection.endLine),
      quote: selection.quote,
    };
  }
  if (format === "html") {
    return { line: String(selection.startLine), quote: selection.quote };
  }
  return {};
}

function normalizeSourceLine(text: string): string {
  return text.endsWith("\r") ? text.slice(0, -1) : text;
}

function selectSourceRange(
  sourceDiff: SourceDiff,
  firstLine: number,
  secondLine: number,
  phase: SourceSelection["phase"],
  revision: number,
): SourceSelection {
  const startLine = Math.min(firstLine, secondLine);
  const endLine = Math.max(firstLine, secondLine);
  const quote = sourceDiff
    .filter(
      (line) =>
        line.newLine !== undefined &&
        line.newLine >= startLine &&
        line.newLine <= endLine,
    )
    .sort((left, right) => (left.newLine ?? 0) - (right.newLine ?? 0))
    .map((line) => normalizeSourceLine(line.text))
    .join("\n");

  return { startLine, endLine, quote, phase, revision };
}

function nextMirrorSelection(
  sourceDiff: SourceDiff,
  current: SourceSelection | null,
  line: number,
): SourceSelection {
  const revision = (current?.revision ?? 0) + 1;

  if (current?.phase === "pending") {
    return selectSourceRange(
      sourceDiff,
      current.startLine,
      line,
      "complete",
      revision,
    );
  }
  return selectSourceRange(sourceDiff, line, line, "pending", revision);
}

// The line-addressable source diff (#37/#44): a two-sided gutter (base + head line
// numbers) beside the source text. Head numbers are native buttons, so mouse click,
// Enter, and Space share one selection path. Removed lines keep a visibly unavailable
// blank head cell because no valid head anchor exists. The containing frame owns long
// line overflow and explicit empty/degenerate states.
function SourceDiffView({
  sourceDiff,
  selection,
  onSelectLine,
}: {
  sourceDiff: SourceDiff;
  selection: SourceSelection | null;
  onSelectLine: SelectSourceLine;
}) {
  const empty = sourceDiff.length === 0;
  const allContext =
    !empty && sourceDiff.every((line) => line.change === "context");
  const allAdded =
    !empty && sourceDiff.every((line) => line.change === "added");
  const singleLine = sourceDiff.length === 1;

  return (
    <div
      className="review-file__source-diff-frame"
      data-source-empty={empty}
      data-source-all-context={allContext}
      data-source-all-added={allAdded}
      data-source-single-line={singleLine}
    >
      {empty ? (
        <p className="review-file__source-diff-empty">
          No source lines to display.
        </p>
      ) : (
        <table className="review-file__source-diff">
          <tbody>
            {sourceDiff.map((line, index) => {
              const headLine = line.newLine;
              const selected =
                headLine !== undefined &&
                selection !== null &&
                headLine >= selection.startLine &&
                headLine <= selection.endLine;

              return (
                <tr
                  key={index}
                  className={`review-source-line review-source-line--${line.change}`}
                  data-selected={selected || undefined}
                >
                  <td className="review-source-line__num review-source-line__num--old">
                    {line.oldLine ?? ""}
                  </td>
                  <td
                    className="review-source-line__num review-source-line__num--new"
                    data-anchorable={headLine !== undefined}
                    aria-label={
                      headLine === undefined
                        ? "Removed line has no head anchor"
                        : undefined
                    }
                  >
                    {headLine === undefined ? null : (
                      <button
                        type="button"
                        className="review-source-line__anchor"
                        aria-label={`Select head line ${headLine} for feedback`}
                        aria-pressed={selected}
                        data-anchor-line={headLine}
                        data-anchor-quote={normalizeSourceLine(line.text)}
                        onClick={() => onSelectLine(headLine)}
                      >
                        {headLine}
                      </button>
                    )}
                  </td>
                  <td className="review-source-line__marker" aria-hidden="true">
                    {SOURCE_CHANGE_MARKER[line.change]}
                  </td>
                  <td className="review-source-line__text">{line.text}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// Renders a file's payload. #7 produced the `download` arm (the default fallback);
// #8 fills the `md` arm with two views - the word-level source diff and the rendered
// head; #9 fills the `docx` arm with the server-converted head HTML (no diff - the
// content diff lives in the md mirror). #10 fills the `html` arm (raw content in a
// scriptless sandboxed iframe) and the `pdf` arm (the browser's native viewer via
// the blob URL), closing the union. #37 adds a line-addressable source diff to the
// md and html arms, shown alongside their existing rendered companions.
function FilePayloadView({
  path,
  payload,
  selection,
  onSelectLine,
  comments,
  onSubmitFeedback,
  annotatorFactory,
}: {
  path: string;
  payload: FilePayload;
  selection: SourceSelection | null;
  onSelectLine: SelectSourceLine;
  comments: ReviewComment[];
  onSubmitFeedback?: SubmitFeedback;
  annotatorFactory?: RenderedAnnotatorFactory;
}) {
  if (payload.format === "download") {
    return (
      <a className="review-file__download" href={payload.blobUrl}>
        Download {payload.filename}
      </a>
    );
  }

  if (payload.format === "md") {
    return (
      <div className="review-file__md">
        <RenderedAnnotationSurface
          path={path}
          renderedHtml={payload.renderedHead}
          reviewText={payload.reviewText}
          comments={comments}
          onSubmitFeedback={onSubmitFeedback}
          annotatorFactory={annotatorFactory}
          hint={
            <p className="mirror-annotation__hint">
              Select text below to comment on the rendered Mirror.
            </p>
          }
        />
        <details className="review-file__source-details">
          <summary>View source changes</summary>
          <div className="review-file__md-diff">
            {payload.diff.map((segment, index) => {
              if (segment.added) {
                return <ins key={index}>{segment.value}</ins>;
              }
              if (segment.removed) {
                return <del key={index}>{segment.value}</del>;
              }
              return <span key={index}>{segment.value}</span>;
            })}
          </div>
          <SourceDiffView
            sourceDiff={payload.sourceDiff}
            selection={selection}
            onSelectLine={onSelectLine}
          />
        </details>
      </div>
    );
  }

  if (payload.format === "docx") {
    // The rendered Canonical joins the SAME annotation engine as the Mirror (#67): its
    // server-converted mammoth HTML is trusted, so it mounts directly (no client-side
    // sanitize, unlike the untrusted HTML arm), and a selection becomes a durable
    // rendered-text comment against the server-reproduced review-text. The existing
    // section-plus-quote locator stays available below as the secondary affordance.
    return (
      <div className="review-file__docx">
        <RenderedAnnotationSurface
          path={path}
          renderedHtml={payload.renderedHead}
          reviewText={payload.reviewText}
          comments={comments}
          onSubmitFeedback={onSubmitFeedback}
          annotatorFactory={annotatorFactory}
          hint={
            <p className="mirror-annotation__hint">
              Select text below to comment on the rendered Canonical.
            </p>
          }
        />
      </div>
    );
  }

  if (payload.format === "html") {
    // Two explicit review surfaces for untrusted HTML (#65). The sanitized copy is the
    // safe, selectable semantics in the application DOM, now also the rendered-text
    // annotation surface (#66) - selecting it creates a durable comment against the
    // server-reproduced review-text, the same lifecycle the Mirror uses. The iframe is
    // the authored visual comparison: its URL serves the raw head bytes with a no-egress
    // CSP (#78). The most-restrictive sandbox keeps scripts, same-origin access, forms,
    // popups, and automatic navigation unavailable; `inert` also prevents reviewer
    // interaction from activating authored links. The line-addressable source diff sits
    // alongside both so markup and result are reviewed together (#37).
    return (
      <div className="review-file__html">
        <SanitizedHtmlSurface
          raw={payload.raw}
          reviewText={payload.reviewText}
          path={path}
          comments={comments}
          onSubmitFeedback={onSubmitFeedback}
          annotatorFactory={annotatorFactory}
        />
        {payload.comparisonUrl ? (
          <iframe
            className="review-file__html-rendered"
            title="Rendered HTML source"
            sandbox=""
            src={resolveApiResourceUrl(payload.comparisonUrl)}
            inert
          />
        ) : null}
        <details className="review-file__source-details">
          <summary>View source changes</summary>
          <SourceDiffView
            sourceDiff={payload.sourceDiff}
            selection={selection}
            onSelectLine={onSelectLine}
          />
        </details>
      </div>
    );
  }

  // pdf: the browser's native viewer, pointed at the blob-serving route.
  return (
    <embed
      className="review-file__pdf"
      type="application/pdf"
      src={payload.blobUrl}
    />
  );
}

type SubmitFeedback = (anchor: FeedbackAnchor) => void | Promise<void>;

function formValue(form: FormData, name: string): string {
  return String(form.get(name) ?? "");
}

// Guards a feedback form against a double-fire while its async submission is in flight
// (#89): a fast double-click or double Enter must persist only one comment. While the
// shared handler's promise is unresolved, `pending` is true - the submit button renders
// disabled and a repeat submit is ignored; once it settles (success or error) the form
// re-enables so a failed submit can be retried. Only a genuinely async submission opens
// an in-flight window, so a synchronous handler (no in-flight window) neither disables
// nor guards. Error REPORTING stays with the page (the durable-write vs failed-refresh
// split); this hook only owns the form's own lock, so it re-enables on either outcome.
function usePendingFeedbackSubmit(onSubmitFeedback?: SubmitFeedback): {
  pending: boolean;
  submitFeedback: (anchor: FeedbackAnchor) => void;
} {
  const [pending, setPending] = useState(false);

  const submitFeedback = (anchor: FeedbackAnchor): void => {
    if (pending) return;
    const result = onSubmitFeedback?.(anchor);
    if (!(result instanceof Promise)) return;
    setPending(true);
    const settle = (): void => setPending(false);
    void result.then(settle, settle);
  };

  return { pending, submitFeedback };
}

function FileFeedbackForm({
  file,
  selection,
  fields,
  onFieldChange,
  onSubmitFeedback,
}: {
  file: ChangedFileView;
  selection: SourceSelection | null;
  fields: DraftFields;
  onFieldChange: (name: string, value: string) => void;
  onSubmitFeedback?: SubmitFeedback;
}): ReactElement | null {
  // Called before the early return so hook order stays stable across renders.
  const { pending, submitFeedback } =
    usePendingFeedbackSubmit(onSubmitFeedback);

  if (file.payload.format === "download" || file.changeType === "deleted") {
    return null;
  }

  const submit = (
    event: FormEvent<HTMLFormElement>,
    createAnchor: (form: FormData) => FeedbackAnchor,
  ): void => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    submitFeedback(createAnchor(form));
  };

  const bodyField = (
    <label>
      Feedback
      <textarea
        name="body"
        required
        value={fields.body ?? ""}
        onChange={(event) => onFieldChange("body", event.target.value)}
      />
    </label>
  );

  if (file.payload.format === "md") {
    return (
      <form
        className="review-feedback-form"
        data-feedback-scope="range"
        data-feedback-path={file.path}
        onSubmit={(event) =>
          submit(event, (form) => ({
            scope: "range",
            path: file.path,
            startLine: Number(formValue(form, "startLine")),
            endLine: Number(formValue(form, "endLine")),
            quote: formValue(form, "quote"),
            body: formValue(form, "body"),
          }))
        }
      >
        <h4>Comment on Mirror range</h4>
        <p className="review-feedback-form__anchor-hint" aria-live="polite">
          {!selection
            ? "Choose one head line, then another to select a range."
            : selection.phase === "pending"
              ? `Selected head line ${selection.startLine}. Choose another head line to complete a range.`
              : `Selected head ${selection.startLine === selection.endLine ? `line ${selection.startLine}` : `lines ${selection.startLine}-${selection.endLine}`}. The next selection starts a new range.`}
        </p>
        <label>
          Start line
          <input
            name="startLine"
            type="number"
            min="1"
            value={fields.startLine ?? ""}
            onChange={(event) => onFieldChange("startLine", event.target.value)}
            required
          />
        </label>
        <label>
          End line
          <input
            name="endLine"
            type="number"
            min="1"
            value={fields.endLine ?? ""}
            onChange={(event) => onFieldChange("endLine", event.target.value)}
            required
          />
        </label>
        <label>
          Exact lines
          <textarea
            name="quote"
            value={fields.quote ?? ""}
            onChange={(event) => onFieldChange("quote", event.target.value)}
            required
          />
        </label>
        {bodyField}
        <button type="submit" disabled={pending}>
          Add feedback
        </button>
      </form>
    );
  }

  if (file.payload.format === "docx") {
    return (
      <form
        className="review-feedback-form"
        data-feedback-scope="canonical"
        data-feedback-path={file.path}
        onSubmit={(event) =>
          submit(event, (form) => ({
            scope: "file",
            path: file.path,
            locator: {
              section: formValue(form, "section"),
              quote: formValue(form, "locatorQuote"),
            },
            body: formValue(form, "body"),
          }))
        }
      >
        <h4>Comment on Canonical section</h4>
        <label>
          Section
          <input
            name="section"
            value={fields.section ?? ""}
            onChange={(event) => onFieldChange("section", event.target.value)}
            required
          />
        </label>
        <label>
          Nearby exact quote
          <textarea
            name="locatorQuote"
            value={fields.locatorQuote ?? ""}
            onChange={(event) =>
              onFieldChange("locatorQuote", event.target.value)
            }
            required
          />
        </label>
        {bodyField}
        <button type="submit" disabled={pending}>
          Add feedback
        </button>
      </form>
    );
  }

  if (file.payload.format === "html") {
    return (
      <form
        className="review-feedback-form"
        data-feedback-scope="line"
        data-feedback-path={file.path}
        onSubmit={(event) =>
          submit(event, (form) => ({
            scope: "line",
            path: file.path,
            line: Number(formValue(form, "line")),
            quote: formValue(form, "quote"),
            body: formValue(form, "body"),
          }))
        }
      >
        <h4>Comment on HTML source line</h4>
        <p className="review-feedback-form__anchor-hint" aria-live="polite">
          {selection
            ? `Selected head line ${selection.startLine}.`
            : "Choose a head line in the source diff."}
        </p>
        <label>
          Head line
          <input
            name="line"
            type="number"
            min="1"
            value={fields.line ?? ""}
            onChange={(event) => onFieldChange("line", event.target.value)}
            required
          />
        </label>
        <label>
          Exact source line
          <textarea
            name="quote"
            value={fields.quote ?? ""}
            onChange={(event) => onFieldChange("quote", event.target.value)}
            required
          />
        </label>
        {bodyField}
        <button type="submit" disabled={pending}>
          Add feedback
        </button>
      </form>
    );
  }

  return (
    <form
      className="review-feedback-form"
      data-feedback-scope="file"
      data-feedback-path={file.path}
      onSubmit={(event) =>
        submit(event, (form) => ({
          scope: "file",
          path: file.path,
          body: formValue(form, "body"),
        }))
      }
    >
      <h4>Comment on PDF</h4>
      {bodyField}
      <button type="submit" disabled={pending}>
        Add feedback
      </button>
    </form>
  );
}

function ReviewFile({
  file,
  draft,
  onDraftChange,
  onSubmitFeedback,
  comments,
  annotatorFactory,
}: {
  file: ChangedFileView;
  draft: DocumentDraft;
  onDraftChange: (draft: DocumentDraft) => void;
  onSubmitFeedback?: SubmitFeedback;
  comments: ReviewComment[];
  annotatorFactory?: RenderedAnnotatorFactory;
}) {
  const selection = draft.selection;

  const selectLine = (line: number): void => {
    const payload = file.payload;
    let nextSelection: SourceSelection;

    if (payload.format === "md") {
      nextSelection = nextMirrorSelection(payload.sourceDiff, selection, line);
    } else if (payload.format === "html") {
      nextSelection = selectSourceRange(
        payload.sourceDiff,
        line,
        line,
        "complete",
        (selection?.revision ?? 0) + 1,
      );
    } else {
      return;
    }

    onDraftChange({
      selection: nextSelection,
      fields: {
        ...draft.fields,
        ...selectionSeededFields(payload.format, nextSelection),
      },
    });
  };

  const setField = (name: string, value: string): void => {
    onDraftChange({
      ...draft,
      fields: { ...draft.fields, [name]: value },
    });
  };

  return (
    <li className="review-file">
      <span
        className={`review-file__marker review-file__marker--${file.changeType}`}
      >
        {CHANGE_MARKER[file.changeType]}
      </span>
      <span className="review-file__path">{file.path}</span>
      <FilePayloadView
        path={file.path}
        payload={file.payload}
        selection={selection}
        onSelectLine={selectLine}
        comments={comments}
        onSubmitFeedback={onSubmitFeedback}
        annotatorFactory={annotatorFactory}
      />
      <FileFeedbackForm
        file={file}
        selection={selection}
        fields={draft.fields}
        onFieldChange={setField}
        onSubmitFeedback={onSubmitFeedback}
      />
    </li>
  );
}

function ActiveDocumentReview({
  file,
  headSha,
  draft,
  onDraftChange,
  onSubmitFeedback,
  comments,
  annotatorFactory,
}: {
  file: ChangedFileView | undefined;
  headSha: string;
  draft: DocumentDraft;
  onDraftChange: (draft: DocumentDraft) => void;
  onSubmitFeedback?: SubmitFeedback;
  comments: ReviewComment[];
  annotatorFactory?: RenderedAnnotatorFactory;
}) {
  if (!file) return <p>No document selected.</p>;

  return (
    <ul className="review-surface__files">
      <ReviewFile
        key={`${headSha}:${file.path}`}
        file={file}
        draft={draft}
        onDraftChange={onDraftChange}
        onSubmitFeedback={onSubmitFeedback}
        comments={comments}
        annotatorFactory={annotatorFactory}
      />
    </ul>
  );
}

function CommentAnchor({ comment }: { comment: ReviewComment }) {
  if (comment.scope === "review") {
    return <span>Whole review</span>;
  }
  if (comment.scope === "range") {
    return (
      <span>
        {comment.path}:{comment.startLine}-{comment.endLine} - {comment.quote}
      </span>
    );
  }
  if (comment.scope === "line") {
    return (
      <span>
        {comment.path}:{comment.line} - {comment.quote}
      </span>
    );
  }
  if (comment.scope === "rendered") {
    return (
      <span>
        {comment.path} - {comment.quote}
      </span>
    );
  }
  if ("locator" in comment) {
    return (
      <span>
        {comment.path} - {comment.locator.section} - {comment.locator.quote}
      </span>
    );
  }
  return <span>{comment.path}</span>;
}

type RoundAction = () => void | Promise<void>;
type ResolveAction = (commentId: string) => void | Promise<void>;

// The reviewer-driven round transitions (#39), offered ONLY when valid: an open
// round can be finished, and approved only when it has zero unresolved comments; a
// finished or approved round shows its frozen/terminal state with no controls.
function RoundControls({
  currentRound,
  onFinish,
  onApprove,
}: {
  currentRound: ReviewRound;
  onFinish?: RoundAction;
  onApprove?: RoundAction;
}) {
  if (currentRound.status !== "open") {
    return (
      <p className="review-round-state" data-round-status={currentRound.status}>
        {currentRound.status === "finished"
          ? "Round finished - frozen until a new head opens the next round."
          : "Round approved - the review is complete."}
      </p>
    );
  }

  const hasUnresolved = currentRound.comments.some(
    (comment) => !comment.resolved,
  );

  return (
    <div className="review-round-controls" data-round-status="open">
      <form
        className="review-round-action"
        onSubmit={(event) => {
          event.preventDefault();
          void onFinish?.();
        }}
      >
        <button type="submit" data-round-action="finish">
          Finish round
        </button>
      </form>
      {hasUnresolved ? null : (
        <form
          className="review-round-action"
          onSubmit={(event) => {
            event.preventDefault();
            void onApprove?.();
          }}
        >
          <button type="submit" data-round-action="approve">
            Approve
          </button>
        </form>
      )}
    </div>
  );
}

type ReviewSurfaceViewProps = ReviewSurfaceResponse & {
  onSubmitFeedback?: SubmitFeedback;
  onFinish?: RoundAction;
  onResolve?: ResolveAction;
  onApprove?: RoundAction;
  // The rendered-Mirror annotation adapter. Injected as a fake in mounted-DOM tests;
  // production leaves it undefined and the surface lazily loads the Recogito adapter.
  annotatorFactory?: RenderedAnnotatorFactory;
};

function ReviewModeToggle({
  mode,
  onChange,
}: {
  mode: ReviewMode;
  onChange: (mode: ReviewMode) => void;
}) {
  return (
    <div className="review-mode-toggle" role="group" aria-label="Review mode">
      <button
        type="button"
        aria-label="Use evidence review"
        aria-pressed={mode === "evidence"}
        onClick={() => onChange("evidence")}
      >
        Evidence
      </button>
      <button
        type="button"
        aria-label="Use guided review"
        aria-pressed={mode === "guided"}
        onClick={() => onChange("guided")}
      >
        Guided
      </button>
    </div>
  );
}

function ChangedDocumentStrip({
  files,
  activePath,
  onSelect,
}: {
  files: ChangedFileView[];
  activePath: string | undefined;
  onSelect: (path: string) => void;
}) {
  return (
    <section
      className="review-documents"
      aria-labelledby="review-documents-title"
    >
      <div className="review-documents__heading">
        <p>Document set</p>
        <h2 id="review-documents-title">Changed documents</h2>
        <span>
          {files.length} {files.length === 1 ? "document" : "documents"} in this
          review
        </span>
      </div>
      {files.length === 0 ? (
        <p className="review-documents__empty">No changed documents.</p>
      ) : (
        <ol className="review-documents__list">
          {files.map((file, index) => (
            <li key={file.path}>
              <button
                type="button"
                aria-label={`Review ${file.path}`}
                aria-current={file.path === activePath ? "true" : undefined}
                onClick={() => onSelect(file.path)}
              >
                <span className="review-documents__number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="review-documents__role">
                  {FORMAT_LABEL[file.payload.format]}
                </span>
                <strong>{fileName(file.path)}</strong>
                <small className="review-documents__path">{file.path}</small>
                <small className="review-documents__change">
                  {documentChangeSummary(file)}
                </small>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function AgentSummary({
  description,
  activeFile,
}: {
  description: string;
  activeFile: ChangedFileView | undefined;
}) {
  const summaryItems = agentSummaryItems(description);

  return (
    <aside
      className="review-agent-summary"
      aria-labelledby="agent-summary-title"
    >
      <p className="review-agent-summary__eyebrow">Agent summary</p>
      <h2 id="agent-summary-title">What changed</h2>
      {summaryItems.length > 0 ? (
        <ul className="review-agent-summary__description">
          {summaryItems.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="review-agent-summary__description">
          The agent did not provide a change summary.
        </p>
      )}
      {activeFile ? (
        <section className="review-agent-summary__document">
          <span>Current document</span>
          <h3>{fileName(activeFile.path)}</h3>
          <p>{documentChangeSummary(activeFile)}</p>
          <dl>
            <div>
              <dt>Role</dt>
              <dd>{FORMAT_LABEL[activeFile.payload.format]}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{CHANGE_MARKER[activeFile.changeType]}</dd>
            </div>
          </dl>
        </section>
      ) : null}
      <p className="review-agent-summary__source-note">
        Summary source: pull request description and verified file changes.
      </p>
    </aside>
  );
}

function RetainedFeedback({
  currentRound,
  rounds,
  onSubmitFeedback,
  onFinish,
  onResolve,
  onApprove,
}: Pick<
  ReviewSurfaceViewProps,
  | "currentRound"
  | "rounds"
  | "onSubmitFeedback"
  | "onFinish"
  | "onResolve"
  | "onApprove"
>) {
  const { pending: reviewPending, submitFeedback: submitReviewFeedback } =
    usePendingFeedbackSubmit(onSubmitFeedback);

  return (
    <section className="review-feedback" aria-labelledby="feedback-title">
      <h2 id="feedback-title">Retained feedback</h2>
      <p>
        Current round {currentRound.number} - {currentRound.headSha} -{" "}
        <span
          className="review-round-status"
          data-round-status={currentRound.status}
        >
          {currentRound.status}
        </span>
      </p>
      <RoundControls
        currentRound={currentRound}
        onFinish={onFinish}
        onApprove={onApprove}
      />
      {rounds.map((round) => (
        <section className="review-round" key={round.number}>
          <h3>
            Round {round.number} - {round.headSha}
          </h3>
          {round.comments.length === 0 ? (
            <p>No feedback yet.</p>
          ) : (
            <ul>
              {round.comments.map((comment) => (
                <li
                  key={comment.id}
                  data-comment-id={comment.id}
                  data-carried-forward={comment.carriedForward}
                  data-drifted={comment.drifted}
                >
                  {comment.carriedForward || comment.drifted ? (
                    <div className="review-comment__flags">
                      {comment.carriedForward ? (
                        <span className="review-comment__carried">
                          Carried forward
                        </span>
                      ) : null}
                      {comment.drifted ? (
                        <span className="review-comment__drifted">
                          Original anchor drifted - verify against the current
                          head
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  <CommentAnchor comment={comment} />
                  <p>{comment.body}</p>
                  {comment.resolved ? (
                    <span className="review-comment__resolved">Resolved</span>
                  ) : round.number === currentRound.number &&
                    round.status === "open" &&
                    onResolve ? (
                    <form
                      className="review-round-action"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void onResolve(comment.id);
                      }}
                    >
                      <button
                        type="submit"
                        data-round-action="resolve"
                        data-comment-id={comment.id}
                      >
                        Resolve
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      <form
        className="review-feedback-form"
        data-feedback-scope="review"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          submitReviewFeedback({
            scope: "review",
            body: formValue(form, "body"),
          });
        }}
      >
        <h3>Comment on whole review</h3>
        <label>
          Feedback
          <textarea name="body" required />
        </label>
        <button type="submit" disabled={reviewPending}>
          Add feedback
        </button>
      </form>
    </section>
  );
}

// Presentational: renders a PR's review surface from props. No fetching, so it
// renders deterministically for the client smoke test.
export function ReviewSurfaceView({
  number,
  title,
  description,
  sourceBranchUrl,
  githubUrl,
  files,
  currentRound,
  rounds,
  onSubmitFeedback,
  onFinish,
  onResolve,
  onApprove,
  annotatorFactory,
}: ReviewSurfaceViewProps) {
  const [mode, setMode] = useState<ReviewMode>("evidence");
  const [activePath, setActivePath] = useState(files[0]?.path);
  const [showGuidedSummary, setShowGuidedSummary] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, DocumentDraft>>({});
  const activeFile = files.find((file) => file.path === activePath) ?? files[0];
  const activeIndex = activeFile ? files.indexOf(activeFile) : -1;
  const guidedStepCount = files.length + 1;
  const guidedStep = showGuidedSummary ? 1 : activeIndex + 2;

  // Drafts are scoped to the current head as well as the document path: a new head
  // supersedes the reviewed content, so every document's feedback starts pristine
  // rather than inheriting a draft that now points at stale lines (this matches the
  // per-head remount key on ReviewFile).
  const activeDraftKey = activeFile
    ? `${currentRound.headSha}:${activeFile.path}`
    : undefined;
  const activeDraft = (activeDraftKey && drafts[activeDraftKey]) || EMPTY_DRAFT;
  const updateActiveDraft = (next: DocumentDraft): void => {
    if (!activeDraftKey) return;
    setDrafts((current) => ({ ...current, [activeDraftKey]: next }));
  };

  const selectDocument = (path: string): void => {
    setActivePath(path);
    if (mode === "guided") setShowGuidedSummary(false);
  };

  return (
    <div className="review-surface" data-review-mode-current={mode}>
      <header className="review-surface__header">
        <div>
          <p className="review-surface__eyebrow">Document review</p>
          <h1 className="review-surface__title">
            #{number} {title}
          </h1>
          <div className="review-surface__links">
            <a className="review-surface__source-branch" href={sourceBranchUrl}>
              Source branch
            </a>
            <a className="review-surface__github" href={githubUrl}>
              Open on GitHub
            </a>
          </div>
        </div>
        <ReviewModeToggle mode={mode} onChange={setMode} />
      </header>

      <ChangedDocumentStrip
        files={files}
        activePath={
          mode === "guided" && showGuidedSummary ? undefined : activeFile?.path
        }
        onSelect={selectDocument}
      />

      <div className={`review-mode-layout review-mode-layout--${mode}`}>
        {mode === "evidence" ? (
          <AgentSummary description={description} activeFile={activeFile} />
        ) : (
          <div className="review-guided__context">
            <header className="review-guided__step">
              <p>
                Step {guidedStep} of {guidedStepCount}
              </p>
              <h2>
                {showGuidedSummary
                  ? "Change summary"
                  : activeFile
                    ? fileName(activeFile.path)
                    : "No document"}
              </h2>
              {!showGuidedSummary && activeFile ? (
                <span>
                  Document {activeIndex + 1} of {files.length} -{" "}
                  {documentChangeSummary(activeFile)}
                </span>
              ) : null}
            </header>
            {showGuidedSummary ? (
              <AgentSummary description={description} activeFile={undefined} />
            ) : null}
          </div>
        )}
        <div
          className="review-document-canvas"
          hidden={mode === "guided" && showGuidedSummary}
        >
          <ActiveDocumentReview
            file={activeFile}
            headSha={currentRound.headSha}
            draft={activeDraft}
            onDraftChange={updateActiveDraft}
            onSubmitFeedback={onSubmitFeedback}
            comments={currentRound.comments}
            annotatorFactory={annotatorFactory}
          />
        </div>
        {mode === "guided" && files.length > 0 ? (
          <nav
            className="review-guided__navigation"
            aria-label="Document steps"
          >
            <button
              type="button"
              aria-label="Previous review step"
              disabled={showGuidedSummary}
              onClick={() => {
                if (activeIndex <= 0) {
                  setShowGuidedSummary(true);
                  return;
                }
                setActivePath(files[activeIndex - 1]?.path);
              }}
            >
              Previous step
            </button>
            <button
              type="button"
              aria-label="Next review step"
              disabled={!showGuidedSummary && activeIndex >= files.length - 1}
              onClick={() => {
                if (showGuidedSummary) {
                  setShowGuidedSummary(false);
                  return;
                }
                setActivePath(files[activeIndex + 1]?.path);
              }}
            >
              Next step
            </button>
          </nav>
        ) : null}
      </div>

      <RetainedFeedback
        currentRound={currentRound}
        rounds={rounds}
        onSubmitFeedback={onSubmitFeedback}
        onFinish={onFinish}
        onResolve={onResolve}
        onApprove={onApprove}
      />
    </div>
  );
}
