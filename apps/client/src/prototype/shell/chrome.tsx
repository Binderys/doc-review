import type {
  ChangedFileView,
  ChangeType,
  FilePayload,
  ReviewComment,
  ReviewRound,
  ReviewSurfaceResponse,
  RoundStatus,
} from "@doc-review/api-contracts";
import type { ShellTheme } from "./shellTheme";

// Shared identity and content atoms for the editorial shell. These are the studio
// "header" and the document content the skill says variants may share; the layout that
// arranges them is owned by each variant, never here.

const FORMAT_LABEL: Record<FilePayload["format"], string> = {
  download: "Supporting file",
  md: "Mirror",
  docx: "Canonical",
  html: "HTML document",
  pdf: "PDF document",
};

const CHANGE_LABEL: Record<ChangeType, string> = {
  added: "Added",
  modified: "Modified",
  deleted: "Deleted",
};

// A non-colour glyph per change type, so the state reads without relying on hue.
const CHANGE_GLYPH: Record<ChangeType, string> = {
  added: "+",
  modified: "~",
  deleted: "−",
};

const STATUS_LABEL: Record<RoundStatus, string> = {
  open: "Open",
  finished: "Finished",
  approved: "Approved",
};

const STATUS_GLYPH: Record<RoundStatus, string> = {
  open: "○",
  finished: "▣",
  approved: "●",
};

export function fileName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

export function documentChangeSummary(file: ChangedFileView): string {
  return `${CHANGE_LABEL[file.changeType]} ${FORMAT_LABEL[file.payload.format].toLowerCase()}`;
}

export function formatRole(file: ChangedFileView): string {
  return FORMAT_LABEL[file.payload.format];
}

// The canonical long-stitch seam mark: three sewing stations with the lateral offset
// that makes it a mark and not a kebab menu. Monochrome on the masthead - the spine
// carries structure, not identity (DESIGN "The seam").
export function SeamMark() {
  return (
    <svg
      className="es-mark"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3.5}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M10.25 1.9v2.75M13.75 10.65v2.75M10.25 19.4v2.75" />
    </svg>
  );
}

// The masthead line: the binderys lockup, then the sibling identity (folio 01, the
// Doc Review app) outside the lockup, then the theme control. Doc Review is folio 01 of
// the studio's own tools - the sibling relationship the DESIGN "Lockup" note describes.
export function Masthead({
  theme,
  onThemeChange,
}: {
  theme: ShellTheme;
  onThemeChange: (theme: ShellTheme) => void;
}) {
  return (
    <header className="es-masthead">
      <span className="es-lockup">
        <SeamMark />
        <span className="es-wordmark">binderys</span>
      </span>
      <span className="es-sibling">
        <span className="es-folio">folio 01</span>
        <span className="es-sibling__name">Doc Review</span>
      </span>
      <span className="es-masthead__spacer" />
      <ThemeControl theme={theme} onThemeChange={onThemeChange} />
    </header>
  );
}

function ThemeControl({
  theme,
  onThemeChange,
}: {
  theme: ShellTheme;
  onThemeChange: (theme: ShellTheme) => void;
}) {
  return (
    <div className="es-theme" role="group" aria-label="Theme">
      <button
        type="button"
        aria-pressed={theme === "paper"}
        onClick={() => onThemeChange("paper")}
      >
        Paper
      </button>
      <button
        type="button"
        aria-pressed={theme === "ink"}
        onClick={() => onThemeChange("ink")}
      >
        Ink
      </button>
    </div>
  );
}

export function ChangeChip({ changeType }: { changeType: ChangeType }) {
  return (
    <span className={`es-chip es-chip--${changeType}`}>
      <span className="es-chip__glyph" aria-hidden="true">
        {CHANGE_GLYPH[changeType]}
      </span>
      {CHANGE_LABEL[changeType]}
    </span>
  );
}

export function RoundStatusTag({ status }: { status: RoundStatus }) {
  return (
    <span className="es-status" data-status={status}>
      <span className="es-status__glyph" aria-hidden="true">
        {STATUS_GLYPH[status]}
      </span>
      {STATUS_LABEL[status]}
    </span>
  );
}

// The Binding: the structured record of how this review is held together (round, exact
// head, status, document count). Machine truth renders in mono; the dashed rules that
// frame it are the waxed-thread seam. `orientation` lets a variant stack it in a rail or
// lay it inline as a ledger band without duplicating the field mapping.
export function BindingRecord({
  surface,
  orientation = "stacked",
}: {
  surface: ReviewSurfaceResponse;
  orientation?: "stacked" | "inline";
}) {
  const round = surface.currentRound;
  return (
    <section
      className={`es-binding es-binding--${orientation}`}
      aria-label="Review record"
    >
      <p className="es-binding__label">Binding</p>
      <dl className="es-binding__rows">
        <div>
          <dt>Round</dt>
          <dd className="es-mono">{round.number}</dd>
        </div>
        <div>
          <dt>Exact head</dt>
          <dd className="es-mono">{round.headSha.slice(0, 12)}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>
            <RoundStatusTag status={round.status} />
          </dd>
        </div>
        <div>
          <dt>Documents</dt>
          <dd className="es-mono">{surface.files.length}</dd>
        </div>
      </dl>
    </section>
  );
}

function summaryItems(description: string): string[] {
  const lines = description
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const stripMarker = (line: string): string =>
    line.replace(/^(?:#{1,6}\s+|[-*+]\s+|\d+\.\s+)/, "");
  const isHeading = (line: string): boolean => /^#{1,6}\s/.test(line);
  const body = lines.filter((line) => !isHeading(line));
  return (body.length > 0 ? body : lines).map(stripMarker).slice(0, 3);
}

export function AgentSummary({ description }: { description: string }) {
  const items = summaryItems(description);
  return (
    <section className="es-summary" aria-label="Agent summary">
      <p className="es-summary__eyebrow">Agent summary</p>
      <h2>What changed</h2>
      {items.length > 0 ? (
        <ul>
          {items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      ) : (
        <p>The agent did not provide a change summary.</p>
      )}
      <p className="es-summary__source">
        Summary source: pull request description and verified file changes.
      </p>
    </section>
  );
}

function commentAnchorText(comment: ReviewComment): string {
  if (comment.scope === "review") return "Whole review";
  if (comment.scope === "range") {
    return `${comment.path}:${comment.startLine}-${comment.endLine}`;
  }
  if (comment.scope === "line") return `${comment.path}:${comment.line}`;
  if (comment.scope === "rendered") return `${comment.path} - rendered`;
  if ("locator" in comment) {
    return `${comment.path} - ${comment.locator.section}`;
  }
  return comment.path;
}

// The retained feedback across rounds: the reviewer-owned lifecycle record. Read-only in
// the prototype (the question is what the shell looks like, not whether writes work), so
// the resolve / finish / approve controls are represented by their state, not wired.
export function RetainedFeedback({
  surface,
}: {
  surface: ReviewSurfaceResponse;
}) {
  return (
    <section className="es-feedback" aria-label="Retained feedback">
      <p className="es-section-label">Retained feedback</p>
      {surface.rounds.map((round: ReviewRound) => (
        <div className="es-round" key={round.number}>
          <h3>
            Round {round.number} - {round.headSha.slice(0, 12)}{" "}
            <RoundStatusTag status={round.status} />
          </h3>
          {round.comments.length === 0 ? (
            <p className="es-empty">No feedback yet.</p>
          ) : (
            round.comments.map((comment) => (
              <div className="es-comment" key={comment.id}>
                {comment.carriedForward || comment.drifted ? (
                  <div className="es-comment__flags">
                    {comment.carriedForward ? (
                      <span className="es-flag">
                        <span aria-hidden="true">{"↳"}</span> Carried forward
                      </span>
                    ) : null}
                    {comment.drifted ? (
                      <span className="es-flag es-flag--drifted">
                        <span aria-hidden="true">{"⚠"}</span> Anchor drifted
                      </span>
                    ) : null}
                  </div>
                ) : null}
                <span className="es-comment__anchor">
                  {commentAnchorText(comment)}
                </span>
                <p className="es-comment__body">{comment.body}</p>
                <RoundStatusTag
                  status={comment.resolved ? "approved" : "open"}
                />
              </div>
            ))
          )}
        </div>
      ))}
    </section>
  );
}

// The three shell state roles the chrome must own: loading, empty, and error. Rendered as
// live exemplars (a real status region, a real alert) so the calm treatment of each can
// be judged and reached by keyboard, without failing a fetch to see them.
export function StateRoles() {
  return (
    <section className="es-states" aria-label="Shell state roles">
      <p className="es-section-label">State roles</p>
      <div className="es-state" role="status">
        <p className="es-state__label">Loading</p>
        <span className="es-skeleton" style={{ width: "70%" }} />
      </div>
      <div className="es-state">
        <p className="es-state__label">Empty</p>
        <div className="es-state__body es-empty">No changed documents.</div>
      </div>
      <div className="es-state es-state--error" role="alert">
        <p className="es-state__label">Error</p>
        <div className="es-state__body">
          <span className="es-state__glyph" aria-hidden="true">
            !
          </span>
          The review surface could not be reached.
        </div>
      </div>
    </section>
  );
}
