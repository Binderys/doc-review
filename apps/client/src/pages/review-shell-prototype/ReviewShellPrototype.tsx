import { useEffect, useState } from "react";
import "./reviewShellPrototype.css";

// Three variants of the inherited review shell, switchable via `?variant=`, on the
// existing `/pr/:owner/:repo/:number` route. PROTOTYPE - deterministic fixtures only.

const SHELL_VARIANTS = [
  { key: "ledger", name: "Ledger rail" },
  { key: "proof", name: "Proof desk" },
  { key: "register", name: "Register matrix" },
] as const;

type ShellVariantKey = (typeof SHELL_VARIANTS)[number]["key"];
type Theme = "ink" | "paper";

type FixtureDocument = {
  number: string;
  name: string;
  path: string;
  role: string;
  change: string;
  note: string;
};

const DOCUMENTS: FixtureDocument[] = [
  {
    number: "01",
    name: "review-brief.md",
    path: "docs/review-brief.md",
    role: "Mirror",
    change: "+14 -3",
    note: "Active - 2 threads",
  },
  {
    number: "02",
    name: "review-brief.docx",
    path: "deliverables/review-brief.docx",
    role: "Canonical",
    change: "Rendered",
    note: "Matched - no drift",
  },
  {
    number: "03",
    name: "evidence.pdf",
    path: "appendix/evidence.pdf",
    role: "PDF",
    change: "+1 file",
    note: "Ready - no threads",
  },
];

function SeamMark() {
  return (
    <svg
      className="shell-prototype__mark"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        d="M10.25 1.9v2.75M13.75 10.65v2.75M10.25 19.4v2.75"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function WorkstationIdentity() {
  return (
    <div className="shell-prototype__masthead-line">
      <a
        className="shell-prototype__lockup"
        href="/"
        aria-label="Binderys home"
      >
        <SeamMark />
        <span>binderys</span>
      </a>
      <span className="shell-prototype__folio">folio 01</span>
      <span className="shell-prototype__product">
        Doc Review / Prototype No. 1
      </span>
    </div>
  );
}

function ThemeControl({
  theme,
  onChange,
}: {
  theme: Theme;
  onChange: () => void;
}) {
  const nextTheme = theme === "ink" ? "paper" : "ink";

  return (
    <button
      className="shell-prototype__theme"
      type="button"
      aria-label={`Switch to ${nextTheme} ground`}
      onClick={onChange}
    >
      <span aria-hidden="true">{theme === "ink" ? "◐" : "◑"}</span>
      Ground: {theme}
    </button>
  );
}

function ShellHeader({
  theme,
  onThemeChange,
}: {
  theme: Theme;
  onThemeChange: () => void;
}) {
  return (
    <header className="shell-prototype__header">
      <WorkstationIdentity />
      <div className="shell-prototype__header-tools">
        <span className="shell-prototype__machine">Binderys/doc-review</span>
        <ThemeControl theme={theme} onChange={onThemeChange} />
      </div>
    </header>
  );
}

function StateRoleStrip({ compact = false }: { compact?: boolean }) {
  return (
    <section
      className={`shell-prototype__states${compact ? " shell-prototype__states--compact" : ""}`}
      aria-label="System state roles"
    >
      <div className="shell-prototype__state" role="status" aria-live="polite">
        <span aria-hidden="true">↻</span>
        <strong>Loading</strong>
        <small>Indexing 3 documents</small>
      </div>
      <div className="shell-prototype__state" role="alert">
        <span aria-hidden="true">!</span>
        <strong>Attention</strong>
        <small>1 source attachment unavailable</small>
      </div>
      <div className="shell-prototype__state" role="status">
        <span aria-hidden="true">○</span>
        <strong>Empty</strong>
        <small>No unresolved blockers</small>
      </div>
    </section>
  );
}

function DocumentList({
  activePath,
  onSelect,
  orientation = "vertical",
}: {
  activePath: string;
  onSelect: (path: string) => void;
  orientation?: "horizontal" | "vertical";
}) {
  return (
    <ol
      className={`shell-prototype__documents shell-prototype__documents--${orientation}`}
      aria-label="Changed documents"
    >
      {DOCUMENTS.map((document) => {
        const active = document.path === activePath;
        return (
          <li key={document.path}>
            <button
              type="button"
              aria-current={active ? "true" : undefined}
              onClick={() => onSelect(document.path)}
            >
              <span className="shell-prototype__document-number">
                {document.number}
              </span>
              <span className="shell-prototype__document-copy">
                <strong>{document.name}</strong>
                <small>{document.role}</small>
                <small>{document.note}</small>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function AuthoredDocument({ document }: { document: FixtureDocument }) {
  return (
    <article
      className="shell-prototype__paper"
      aria-labelledby="authored-document-title"
    >
      <header>
        <p>Review brief / 18 July 2026</p>
        <h2 id="authored-document-title">
          A quieter path through document review
        </h2>
        <span>{document.name} - authored appearance preserved</span>
      </header>
      <p className="shell-prototype__paper-lead">
        The workstation should make the reviewer’s next decision obvious without
        altering the document being reviewed.
      </p>
      <h3>Working agreement</h3>
      <p>
        Keep the canonical and its Mirror together. Show source facts as machine
        truth, keep discussion attached to evidence, and let review state remain
        legible without relying on colour.
      </p>
      <blockquote>
        The shell carries review context. The document keeps its own voice.
      </blockquote>
      <h3>Acceptance evidence</h3>
      <ul>
        <li>
          All three changed documents are available from one review surface.
        </li>
        <li>Two comments remain attached to exact passages in the Mirror.</li>
        <li>The Canonical render matches the current head.</li>
      </ul>
      <p>
        This fixture is intentionally deterministic. It exercises hierarchy,
        containment, and state roles without fetching or mutating product data.
      </p>
    </article>
  );
}

function ThreadList() {
  return (
    <ol className="shell-prototype__threads" aria-label="Review threads">
      <li>
        <span className="shell-prototype__thread-index">T01</span>
        <div>
          <strong>Clarify the handoff owner</strong>
          <p>“next decision obvious” - name the reviewer role here.</p>
          <small>Open - exact passage</small>
        </div>
      </li>
      <li>
        <span className="shell-prototype__thread-index">T02</span>
        <div>
          <strong>Canonical wording differs</strong>
          <p>Check “attached to evidence” against the generated deliverable.</p>
          <small>Carried - round 02</small>
        </div>
      </li>
    </ol>
  );
}

function ReviewActions() {
  return (
    <div className="shell-prototype__actions" aria-label="Review actions">
      <button type="button">Add review note</button>
      <button type="button">Finish round</button>
    </div>
  );
}

export function LedgerRailVariant({
  activePath,
  onSelect,
}: {
  activePath: string;
  onSelect: (path: string) => void;
}) {
  const activeDocument =
    DOCUMENTS.find((document) => document.path === activePath) ?? DOCUMENTS[0];

  return (
    <div className="shell-prototype__layout shell-prototype__layout--ledger">
      <aside
        className="shell-prototype__ledger-nav"
        aria-labelledby="ledger-files-title"
      >
        <div className="shell-prototype__panel-heading">
          <p>Review set</p>
          <h2 id="ledger-files-title">3 documents</h2>
          <span>Round 03 - open</span>
        </div>
        <DocumentList activePath={activePath} onSelect={onSelect} />
        <dl className="shell-prototype__facts">
          <div>
            <dt>Head</dt>
            <dd>c72f814</dd>
          </div>
          <div>
            <dt>Branch</dt>
            <dd>chore/prototype-shell</dd>
          </div>
          <div>
            <dt>Reviewer</dt>
            <dd>Binderys</dd>
          </div>
        </dl>
      </aside>
      <main className="shell-prototype__ledger-main">
        <header className="shell-prototype__review-heading">
          <div>
            <p>Pull request 33 / evidence mode</p>
            <h1>Prototype the inherited Doc Review application shell</h1>
          </div>
          <span className="shell-prototype__round-label">
            Round 03 / 2 open
          </span>
        </header>
        <StateRoleStrip compact />
        <AuthoredDocument document={activeDocument} />
      </main>
      <aside
        className="shell-prototype__ledger-thread"
        aria-labelledby="ledger-thread-title"
      >
        <div className="shell-prototype__panel-heading">
          <p>Thread</p>
          <h2 id="ledger-thread-title">Retained feedback</h2>
          <span>2 open / 4 resolved</span>
        </div>
        <ThreadList />
        <ReviewActions />
      </aside>
    </div>
  );
}

export function ProofDeskVariant({
  activePath,
  onSelect,
}: {
  activePath: string;
  onSelect: (path: string) => void;
}) {
  const activeDocument =
    DOCUMENTS.find((document) => document.path === activePath) ?? DOCUMENTS[0];

  return (
    <main className="shell-prototype__layout shell-prototype__layout--proof">
      <header className="shell-prototype__proof-heading">
        <div>
          <p>PR 33 / Round 03 / Document {activeDocument.number}</p>
          <h1>{activeDocument.name}</h1>
          <span>Prototype the inherited Doc Review application shell</span>
        </div>
        <ReviewActions />
      </header>
      <StateRoleStrip />
      <nav className="shell-prototype__proof-tabs" aria-label="Document tabs">
        <DocumentList
          activePath={activePath}
          onSelect={onSelect}
          orientation="horizontal"
        />
      </nav>
      <section
        className="shell-prototype__proof-stage"
        aria-label="Document proof desk"
      >
        <div
          className="shell-prototype__proof-meta"
          aria-label="Document facts"
        >
          <span>HEAD c72f814</span>
          <span>{activeDocument.role}</span>
          <span>{activeDocument.change}</span>
        </div>
        <AuthoredDocument document={activeDocument} />
        <aside
          className="shell-prototype__margin-thread"
          aria-labelledby="margin-thread-title"
        >
          <p>Margin thread</p>
          <h2 id="margin-thread-title">2 passages</h2>
          <ThreadList />
        </aside>
      </section>
      <footer className="shell-prototype__proof-dock">
        <span>Review progress</span>
        <strong>1 of 3 documents inspected</strong>
        <div aria-label="Review progress: 1 of 3">
          <i />
          <i />
          <i />
        </div>
        <span>Next: Canonical</span>
      </footer>
    </main>
  );
}

export function RegisterMatrixVariant({
  activePath,
  onSelect,
}: {
  activePath: string;
  onSelect: (path: string) => void;
}) {
  const activeDocument =
    DOCUMENTS.find((document) => document.path === activePath) ?? DOCUMENTS[0];

  return (
    <main className="shell-prototype__layout shell-prototype__layout--register">
      <header className="shell-prototype__register-heading">
        <div>
          <p>Review register / PR 33</p>
          <h1>Prototype the inherited Doc Review application shell</h1>
        </div>
        <dl className="shell-prototype__register-summary">
          <div>
            <dt>Documents</dt>
            <dd>03</dd>
          </div>
          <div>
            <dt>Threads</dt>
            <dd>02</dd>
          </div>
          <div>
            <dt>Round</dt>
            <dd>03</dd>
          </div>
        </dl>
      </header>
      <StateRoleStrip compact />
      <section
        className="shell-prototype__register-table"
        aria-labelledby="register-title"
      >
        <div className="shell-prototype__panel-heading">
          <p>Evidence queue</p>
          <h2 id="register-title">Changed-document register</h2>
        </div>
        <div className="shell-prototype__table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">No.</th>
                <th scope="col">Role / path</th>
                <th scope="col">Change</th>
                <th scope="col">Review state</th>
                <th scope="col">Open</th>
              </tr>
            </thead>
            <tbody>
              {DOCUMENTS.map((document) => (
                <tr
                  key={document.path}
                  data-active={document.path === activePath || undefined}
                >
                  <td>{document.number}</td>
                  <th scope="row">
                    <strong>{document.role}</strong>
                    <small>{document.path}</small>
                  </th>
                  <td>{document.change}</td>
                  <td>{document.note}</td>
                  <td>
                    <button
                      type="button"
                      aria-label={`Open ${document.path}`}
                      onClick={() => onSelect(document.path)}
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section
        className="shell-prototype__register-work"
        aria-label="Selected evidence"
      >
        <aside className="shell-prototype__register-context">
          <div className="shell-prototype__panel-heading">
            <p>Selected evidence</p>
            <h2>{activeDocument.name}</h2>
            <span>{activeDocument.path}</span>
          </div>
          <dl className="shell-prototype__facts">
            <div>
              <dt>Role</dt>
              <dd>{activeDocument.role}</dd>
            </div>
            <div>
              <dt>Change</dt>
              <dd>{activeDocument.change}</dd>
            </div>
            <div>
              <dt>Head</dt>
              <dd>c72f814</dd>
            </div>
          </dl>
          <ThreadList />
          <ReviewActions />
        </aside>
        <AuthoredDocument document={activeDocument} />
      </section>
    </main>
  );
}

function PrototypeNavigator({
  current,
  onCycle,
}: {
  current: ShellVariantKey;
  onCycle: (direction: -1 | 1) => void;
}) {
  const active =
    SHELL_VARIANTS.find((item) => item.key === current) ?? SHELL_VARIANTS[0];

  return (
    <nav className="shell-prototype__navigator" aria-label="Prototype variants">
      <button
        type="button"
        aria-label="Previous variant"
        onClick={() => onCycle(-1)}
      >
        ←
      </button>
      <span aria-live="polite">
        No. 1 / <b>{active.key}</b> - {active.name}
      </span>
      <button
        type="button"
        aria-label="Next variant"
        onClick={() => onCycle(1)}
      >
        →
      </button>
      <small>Use left and right arrow keys</small>
    </nav>
  );
}

function variantFromLocation(): ShellVariantKey {
  const requested = new URLSearchParams(window.location.search).get("variant");
  return SHELL_VARIANTS.some((variant) => variant.key === requested)
    ? (requested as ShellVariantKey)
    : SHELL_VARIANTS[0].key;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.matches("input, textarea, select, [contenteditable='true']")
  );
}

export function ReviewShellPrototype() {
  const [current, setCurrent] = useState<ShellVariantKey>(variantFromLocation);
  const [theme, setTheme] = useState<Theme>(() => {
    return localStorage.getItem("doc-review-shell-theme") === "paper"
      ? "paper"
      : "ink";
  });
  const [activePath, setActivePath] = useState(DOCUMENTS[0].path);

  useEffect(() => {
    const previousTitle = document.title;
    const active =
      SHELL_VARIANTS.find((variant) => variant.key === current) ??
      SHELL_VARIANTS[0];
    document.title = `Prototype No. 1 - ${active.name}`;
    return () => {
      document.title = previousTitle;
    };
  }, [current]);

  const cycle = (direction: -1 | 1): void => {
    const index = SHELL_VARIANTS.findIndex(
      (variant) => variant.key === current,
    );
    const next =
      SHELL_VARIANTS[
        (index + direction + SHELL_VARIANTS.length) % SHELL_VARIANTS.length
      ];
    const url = new URL(window.location.href);
    url.searchParams.set("variant", next.key);
    window.history.replaceState(null, "", url);
    setCurrent(next.key);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTypingTarget(event.target)) return;
      if (event.key === "ArrowLeft") cycle(-1);
      if (event.key === "ArrowRight") cycle(1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => {
    localStorage.setItem("doc-review-shell-theme", theme);
  }, [theme]);

  return (
    <div className="shell-prototype" data-theme={theme} data-variant={current}>
      <ShellHeader
        theme={theme}
        onThemeChange={() =>
          setTheme((value) => (value === "ink" ? "paper" : "ink"))
        }
      />
      <div className="shell-prototype__viewport">
        {current === "ledger" ? (
          <LedgerRailVariant activePath={activePath} onSelect={setActivePath} />
        ) : current === "proof" ? (
          <ProofDeskVariant activePath={activePath} onSelect={setActivePath} />
        ) : (
          <RegisterMatrixVariant
            activePath={activePath}
            onSelect={setActivePath}
          />
        )}
      </div>
      <PrototypeNavigator current={current} onCycle={cycle} />
    </div>
  );
}
