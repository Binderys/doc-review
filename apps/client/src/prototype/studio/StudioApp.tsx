import { useEffect, useMemo, useRef, useState } from "react";
import { applyTheme, readStoredTheme, type StudioTheme } from "./theme";
import { Mark } from "./Mark";
import {
  dashboard,
  findPr,
  type DocFile,
  type DocFormat,
  type DocPr,
  type FeedbackNote,
  type ReviewState,
} from "./fixtures";

// ---- shared vocabulary ------------------------------------------------------

// No status token ships in the identity, so review state is carried by a label plus a
// non-colour cue (a glyph), never by colour alone (DESIGN "State").
const STATE_LABEL: Record<ReviewState, string> = {
  awaiting: "Awaiting review",
  "in-review": "In review",
  changes: "Changes requested",
  approved: "Approved",
};

// Each glyph means its state, and each is distinct at a glance: an open ring not yet
// begun, a half-filled ring underway, a flag raised for changes, a check for approved.
const STATE_GLYPH: Record<ReviewState, string> = {
  awaiting: "○",
  "in-review": "◐",
  changes: "⚑",
  approved: "✓",
};

const FORMAT_LABEL: Record<DocFormat, string> = {
  md: "Mirror",
  docx: "Canonical",
  html: "HTML",
  pdf: "PDF",
};

const CHANGE_LABEL: Record<DocFile["changeType"], string> = {
  added: "added",
  modified: "modified",
  removed: "removed",
};

// ---- masthead ---------------------------------------------------------------

function ThemeControl({
  theme,
  onChange,
}: {
  theme: StudioTheme;
  onChange: (next: StudioTheme) => void;
}) {
  return (
    <div className="st-theme" role="group" aria-label="Ground">
      {(["paper", "ink"] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={theme === option}
          onClick={() => onChange(option)}
        >
          {option === "paper" ? "Paper" : "Ink"}
        </button>
      ))}
    </div>
  );
}

function Masthead({
  theme,
  onTheme,
  onHome,
  crumb,
}: {
  theme: StudioTheme;
  onTheme: (next: StudioTheme) => void;
  onHome: () => void;
  crumb?: string;
}) {
  return (
    <header className="st-masthead">
      <a
        className="st-lockup"
        href="#"
        onClick={(event) => {
          event.preventDefault();
          onHome();
        }}
      >
        <Mark className="st-mark" />
        <span className="st-wordmark">binderys</span>
      </a>
      <span className="st-sibling">
        <span className="st-folio">folio 01</span>
        <span className="st-sibling__name">Doc Review</span>
      </span>
      {crumb ? <span className="st-crumb">{crumb}</span> : null}
      <span className="st-masthead__spacer" />
      <ThemeControl theme={theme} onChange={onTheme} />
    </header>
  );
}

// ---- dashboard --------------------------------------------------------------

function StateTag({ state }: { state: ReviewState }) {
  return (
    <span className={`st-state st-state--${state}`}>
      <span className="st-state__glyph" aria-hidden="true">
        {STATE_GLYPH[state]}
      </span>
      {STATE_LABEL[state]}
    </span>
  );
}

function FormatStrip({ files }: { files: DocFile[] }) {
  return (
    <ul className="st-formats" aria-label="Documents in this pull request">
      {files.map((file) => (
        <li key={file.path} className={`st-format st-format--${file.format}`}>
          <span className="st-format__kind">{FORMAT_LABEL[file.format]}</span>
          <span className="st-format__path">{file.path.split("/").pop()}</span>
        </li>
      ))}
    </ul>
  );
}

function PrCard({ pr, onOpen }: { pr: DocPr; onOpen: (n: number) => void }) {
  return (
    <li className="st-card">
      <button
        type="button"
        className="st-card__hit"
        onClick={() => onOpen(pr.number)}
      >
        <div className="st-card__top">
          <span className="st-card__number">#{pr.number}</span>
          <StateTag state={pr.state} />
        </div>
        <h3 className="st-card__title">{pr.title}</h3>
        <p className="st-card__summary">{pr.summary}</p>
        <FormatStrip files={pr.files} />
        <div className="st-card__meta">
          <span className="st-card__branch">{pr.branch}</span>
          <span className="st-dot" aria-hidden="true">
            ·
          </span>
          <span>{pr.author}</span>
          <span className="st-dot" aria-hidden="true">
            ·
          </span>
          <span>round {pr.round}</span>
          <span className="st-card__age">{pr.age}</span>
        </div>
      </button>
    </li>
  );
}

// Designed empty / unavailable state (DESIGN "State": a label plus a non-colour cue,
// never colour alone). The seam mark stands in for the missing documents.
function RepoState({
  kind,
  title,
  body,
  action,
}: {
  kind: "empty" | "unavailable";
  title: string;
  body: string;
  action?: string;
}) {
  return (
    <div className={`st-repostate st-repostate--${kind}`}>
      <span className="st-repostate__mark" aria-hidden="true">
        <Mark />
      </span>
      <div className="st-repostate__copy">
        <p className="st-repostate__title">
          <span className="st-repostate__glyph" aria-hidden="true">
            {kind === "unavailable" ? "◇" : "○"}
          </span>
          {title}
        </p>
        <p className="st-repostate__body">{body}</p>
        {action ? (
          <button type="button" className="st-btn st-repostate__action">
            {action}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Dashboard({ onOpen }: { onOpen: (n: number) => void }) {
  const openCount = dashboard.reduce((sum, g) => sum + g.prs.length, 0);
  return (
    <main className="st-dashboard">
      <p className="st-count">
        <span className="st-count__n">{openCount}</span> open for review across{" "}
        <span className="st-count__n">{dashboard.length}</span> watched repos
      </p>

      {dashboard.map((group) => (
        <section className="st-repo" key={group.repo}>
          <div className="st-repo__head">
            <h2 className="st-repo__name">
              <span className="st-repo__owner">{group.owner}</span>
              <span className="st-repo__slash" aria-hidden="true">
                /
              </span>
              {group.repo.split("/")[1]}
            </h2>
            {group.status === "available" ? (
              <span className="st-repo__status st-repo__status--ok">
                <span aria-hidden="true">◆</span> Available
              </span>
            ) : (
              <span className="st-repo__status st-repo__status--down">
                <span aria-hidden="true">◇</span>{" "}
                {group.unavailableReason === "rate-limited"
                  ? "Rate limited"
                  : group.unavailableReason === "access"
                    ? "Access unavailable"
                    : "GitHub unavailable"}
              </span>
            )}
          </div>

          {group.status === "unavailable" ? (
            <RepoState
              kind="unavailable"
              title={
                group.unavailableReason === "rate-limited"
                  ? "GitHub rate limit reached"
                  : group.unavailableReason === "access"
                    ? "Read access unavailable"
                    : "GitHub is unreachable"
              }
              body="This watched repo could not be read right now. Available repos are unaffected; it stays listed and retries on its own until the read recovers."
              action="Retry now"
            />
          ) : group.prs.length === 0 ? (
            <RepoState
              kind="empty"
              title="No documents waiting"
              body="Every open pull request in this repo has been reviewed. New document PRs appear here the moment they open."
            />
          ) : (
            <ul className="st-cards">
              {group.prs.map((pr) => (
                <PrCard key={pr.number} pr={pr} onOpen={onOpen} />
              ))}
            </ul>
          )}
        </section>
      ))}
    </main>
  );
}

// ---- review surface ---------------------------------------------------------

function DiffRibbon({ file }: { file: DocFile }) {
  if (!file.diff) {
    return (
      <p className="st-ribbon st-ribbon--whole">
        {CHANGE_LABEL[file.changeType]} in full
      </p>
    );
  }
  return (
    <p className="st-ribbon" aria-label="Inline change">
      {file.diff.map((seg, i) => (
        <span
          key={i}
          className={seg.added ? "st-ins" : seg.removed ? "st-del" : "st-ctx"}
        >
          {seg.value}
        </span>
      ))}
    </p>
  );
}

// How each format announces itself in the reading pane. The canonical (docx) and the
// PDF are page-shaped deliverables, so they render on a sheet; the mirror and HTML are
// content sources and render flush. Every format is rendered on the server (CONTEXT
// "Rendering") - the note makes that promise visible.
const FORMAT_NOTE: Record<DocFormat, string> = {
  md: "Markdown mirror - the content source of truth diffs run against.",
  docx: "Canonical deliverable - generated from the mirror, never hand-edited.",
  html: "HTML document - rendered on the server; sanitized before display.",
  pdf: "PDF - rasterized on the server; the file never leaves the network.",
};

const SHEET_FORMATS: ReadonlySet<DocFormat> = new Set(["docx", "pdf"]);

// A selection captured inside the reading pane, and where to float the action for it.
interface Pending {
  quote: string;
  x: number;
  y: number;
}

// Minimum characters before an accidental double-click counts as an intent to comment.
const MIN_QUOTE = 3;

function ReadingPane({
  file,
  onQuote,
}: {
  file: DocFile;
  onQuote: (quote: string) => void;
}) {
  // The core review gesture: select a passage and a deliberate "Add note" button
  // appears at the selection - not a silent hijack, and not buried in the ledger.
  const [pending, setPending] = useState<Pending | null>(null);
  const proseRef = useRef<HTMLDivElement>(null);

  function captureSelection() {
    const selection = window.getSelection?.();
    const quote = selection?.toString().trim() ?? "";
    if (
      !selection ||
      selection.isCollapsed ||
      quote.length < MIN_QUOTE ||
      !proseRef.current?.contains(selection.anchorNode)
    ) {
      setPending(null);
      return;
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    setPending({
      quote,
      x: rect.left + rect.width / 2,
      y: rect.top,
    });
  }

  // Any scroll or resize invalidates the anchored position, so dismiss rather than
  // leave the button stranded away from its passage.
  useEffect(() => {
    if (!pending) return;
    const dismiss = () => setPending(null);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [pending]);

  const onSheet = SHEET_FORMATS.has(file.format);

  return (
    <article className="st-doc">
      <div className="st-doc__head">
        <span className={`st-format st-format--${file.format}`}>
          <span className="st-format__kind">{FORMAT_LABEL[file.format]}</span>
          <span className="st-format__path">{file.path}</span>
        </span>
        <span className="st-doc__change">{CHANGE_LABEL[file.changeType]}</span>
      </div>
      <p className="st-doc__note">{FORMAT_NOTE[file.format]}</p>
      <DiffRibbon file={file} />
      <div
        className={`st-canvas${onSheet ? " st-canvas--sheet" : ""}`}
        data-format={file.format}
      >
        <div
          ref={proseRef}
          className="st-prose"
          onMouseUp={captureSelection}
          // Fixture HTML is authored in this repo, not fetched; safe for a prototype.
          dangerouslySetInnerHTML={{ __html: file.html }}
        />
      </div>
      {pending ? (
        <button
          type="button"
          className="st-quotebtn"
          style={{ left: pending.x, top: pending.y }}
          // mousedown, not click: fires before the selection clears on blur.
          onMouseDown={(event) => {
            event.preventDefault();
            onQuote(pending.quote);
            setPending(null);
            window.getSelection?.()?.removeAllRanges();
          }}
        >
          <span aria-hidden="true">＋</span> Add note
        </button>
      ) : null}
    </article>
  );
}

function FeedbackLedger({
  pr,
  notes,
  draftQuote,
  draftBody,
  onDraftBody,
  onSubmit,
  onCancel,
}: {
  pr: DocPr;
  notes: FeedbackNote[];
  draftQuote: string | null;
  draftBody: string;
  onDraftBody: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <aside className="st-ledger" aria-label="Feedback">
      <div className="st-ledger__head">
        <span className="st-ledger__label">Binding</span>
        <span className="st-ledger__round">round {pr.round}</span>
      </div>
      <p className="st-ledger__state">
        <StateTag state={pr.state} />
        <span className="st-ledger__notecount">
          {notes.length} {notes.length === 1 ? "note" : "notes"}
        </span>
      </p>

      {draftQuote ? (
        <form
          className="st-composer"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <blockquote className="st-composer__quote">{draftQuote}</blockquote>
          <textarea
            className="st-composer__body"
            placeholder="Leave a note against this passage..."
            value={draftBody}
            autoFocus
            rows={3}
            onChange={(event) => onDraftBody(event.target.value)}
          />
          <div className="st-composer__actions">
            <button
              type="submit"
              className="st-btn st-btn--primary"
              disabled={!draftBody.trim()}
            >
              Add note
            </button>
            <button type="button" className="st-btn" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </form>
      ) : notes.length === 0 ? (
        <p className="st-ledger__empty">
          No feedback yet. Select any passage in the document to leave the first
          note.
        </p>
      ) : (
        <p className="st-ledger__hint">
          Select any passage in the document to add a note.
        </p>
      )}

      {notes.length > 0 ? (
        <ul className="st-notes">
          {notes.map((note) => (
            <li
              key={note.id}
              className={`st-note${note.drifted ? " st-note--drifted" : ""}`}
            >
              <blockquote className="st-note__quote">{note.quote}</blockquote>
              <p className="st-note__body">{note.body}</p>
              <div className="st-note__meta">
                <span>{note.author}</span>
                <span className="st-dot" aria-hidden="true">
                  ·
                </span>
                <span>{note.when}</span>
                {note.drifted ? (
                  <span className="st-flag st-flag--drifted">
                    ⚑ quote drifted
                  </span>
                ) : note.resolved ? (
                  <span className="st-flag st-flag--resolved">✓ resolved</span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="st-ledger__actions">
        {pr.state === "approved" ? (
          <>
            <p className="st-ledger__done">
              <span aria-hidden="true">✓</span> You approved round {pr.round}
            </p>
            <button type="button" className="st-btn">
              Reopen review
            </button>
          </>
        ) : (
          <>
            <button type="button" className="st-btn st-btn--primary">
              Approve round {pr.round}
            </button>
            <button type="button" className="st-btn">
              Request changes
            </button>
          </>
        )}
      </div>
    </aside>
  );
}

function ReviewSurface({
  repo,
  pr,
  onBack,
}: {
  repo: string;
  pr: DocPr;
  onBack: () => void;
}) {
  const [activePath, setActivePath] = useState(pr.files[0]?.path);
  const activeFile = pr.files.find((f) => f.path === activePath) ?? pr.files[0];

  // Live review state: the ledger's notes are seeded from the fixture and grow as the
  // reviewer selects passages and writes against them. Local and throwaway - nothing is
  // persisted, but the gesture is the real one.
  const [notes, setNotes] = useState<FeedbackNote[]>(pr.feedback);
  const [draftQuote, setDraftQuote] = useState<string | null>(null);
  const [draftBody, setDraftBody] = useState("");
  const [seq, setSeq] = useState(1);

  function beginNote(quote: string) {
    setDraftQuote(quote);
    setDraftBody("");
  }

  function cancelNote() {
    setDraftQuote(null);
    setDraftBody("");
  }

  function submitNote() {
    if (!draftQuote || !draftBody.trim() || !activeFile) return;
    setNotes((prev) => [
      ...prev,
      {
        id: `draft-${seq}`,
        path: activeFile.path,
        quote: draftQuote,
        body: draftBody.trim(),
        author: "you",
        when: "just now",
      },
    ]);
    setSeq((n) => n + 1);
    cancelNote();
  }

  return (
    <main className="st-review">
      <div className="st-review__top">
        <button type="button" className="st-back" onClick={onBack}>
          ← All documents
        </button>
        <div className="st-review__ident">
          <span className="st-review__repo">{repo}</span>
          <span className="st-review__number">#{pr.number}</span>
        </div>
      </div>

      <h1 className="st-review__title">{pr.title}</h1>
      <p className="st-review__summary">{pr.summary}</p>
      <div className="st-review__meta">
        <span className="st-review__branch">{pr.branch}</span>
        <span className="st-dot" aria-hidden="true">
          ·
        </span>
        <span>{pr.author}</span>
        <span className="st-dot" aria-hidden="true">
          ·
        </span>
        <span>{pr.age}</span>
      </div>

      <nav className="st-index" aria-label="Documents">
        {pr.files.map((file, i) => (
          <button
            key={file.path}
            type="button"
            className={`st-index__item${
              file.path === activeFile?.path ? " is-active" : ""
            }`}
            onClick={() => {
              setActivePath(file.path);
              cancelNote();
            }}
          >
            <span className="st-index__folio">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="st-index__name">{file.path.split("/").pop()}</span>
            <span className={`st-index__kind st-index__kind--${file.format}`}>
              {FORMAT_LABEL[file.format]}
            </span>
          </button>
        ))}
      </nav>

      <div className="st-review__body">
        {activeFile ? (
          <ReadingPane file={activeFile} onQuote={beginNote} />
        ) : null}
        <FeedbackLedger
          pr={pr}
          notes={notes.filter((note) => note.path === activeFile?.path)}
          draftQuote={draftQuote}
          draftBody={draftBody}
          onDraftBody={setDraftBody}
          onSubmit={submitNote}
          onCancel={cancelNote}
        />
      </div>
    </main>
  );
}

// ---- app --------------------------------------------------------------------

export function StudioApp() {
  const [theme, setTheme] = useState<StudioTheme>(() => readStoredTheme());
  const [openNumber, setOpenNumber] = useState<number | null>(null);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const opened = useMemo(
    () => (openNumber === null ? null : findPr(openNumber)),
    [openNumber],
  );

  return (
    <div className="st-shell">
      <div className="st-frame">
        <Masthead
          theme={theme}
          onTheme={setTheme}
          onHome={() => setOpenNumber(null)}
          crumb={opened ? `#${opened.pr.number}` : undefined}
        />
        {opened ? (
          <ReviewSurface
            repo={opened.repo}
            pr={opened.pr}
            onBack={() => setOpenNumber(null)}
          />
        ) : (
          <Dashboard onOpen={setOpenNumber} />
        )}
        <footer className="st-foot">
          <Mark className="st-foot__mark" />
          <span>
            Throwaway prototype - feat/ui-prototype. Rendered on the server;
            confidential content never leaves the network.
          </span>
        </footer>
      </div>
    </div>
  );
}
