// @vitest-environment jsdom
//
// The production-path matrix (#70): with a NORMAL review route and NO prototype query,
// the review surface must select rendered text BY DEFAULT for Mirror, Canonical, and
// sanitized HTML, driven through the real production seam - no `annotatorFactory` prop is
// injected, so the surface reaches for its lazy annotation loader exactly the way it does
// in the browser. The loader module is the single seam (`loadRenderedAnnotator`); mocking
// it here lets these tests prove (a) it is invoked for the three supported review copies
// and never for PDF, downloads, or deleted files, and (b) the in-memory fake adapter it
// returns drives real DOM selection/paint. jsdom (not the repo-default happy-dom) so the
// HTML case's DOMPurify safe-copy walk runs correctly, matching ReviewSurfaceView.html.dom.
//
// This file exercises the DEFAULT composition and loader wiring the per-format suites
// (ReviewSurfaceView.dom / .canonical.dom / .html.dom) bypass by injecting the fake as a
// prop; it does not restate their exhaustive per-format edge coverage.

import type {
  FeedbackAnchor,
  FilePayload,
  RenderedTextFeedback,
  ReviewComment,
  ReviewSurfaceResponse,
} from "@doc-review/api-contracts";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadRenderedAnnotator } from "../features/annotation/loadRenderedAnnotator";
import { createFakeRenderedAnnotator } from "../features/annotation/renderedAnnotator.fake";
import { ReviewSurfaceView } from "./ReviewSurfaceView";

// The one production loader seam, mocked so no Recogito chunk loads and every invocation
// is observable. Each test resolves it to its own fake adapter controller.
vi.mock("../features/annotation/loadRenderedAnnotator", () => ({
  loadRenderedAnnotator: vi.fn(),
}));

const loadMock = vi.mocked(loadRenderedAnnotator);

// One honest rendered document, shared across the three formats: the head HTML and the
// normalized review-text describe the SAME content, so each planted sentence is genuinely
// visible-and-selectable in the mounted surface, and stored offsets bound the exact quote.
const HEAD_HTML =
  "<h2>Scope</h2>" +
  "<p>Intro paragraph about scope.</p>" +
  "<p>The Bandersnatch metric holds firm across revisions.</p>" +
  "<p>Closing note.</p>";
const REVIEW_TEXT =
  "Scope\nIntro paragraph about scope.\n" +
  "The Bandersnatch metric holds firm across revisions.\nClosing note.";
const PLANTED = "The Bandersnatch metric holds firm across revisions.";
const SECOND = "Intro paragraph about scope.";
const CONTEXT_WINDOW = 32;

// A repeated-quote document: the same quote in two blocks, each with distinct in-block
// context, so quote+context locates its own occurrence without any position or index.
const REPEATED_HEAD =
  "<p>The opening section clearly states Repeated claim as its own central and firmly held point here.</p>" +
  "<p>Much further down the closing section again states Repeated claim to reinforce that same earlier point.</p>";
const REPEATED_REVIEW_TEXT =
  "The opening section clearly states Repeated claim as its own central and firmly held point here.\n" +
  "Much further down the closing section again states Repeated claim to reinforce that same earlier point.";

type RenderedFormat = RenderedTextFeedback["format"];

type FormatCase = {
  name: string;
  format: RenderedFormat;
  path: string;
  // The source-oriented secondary feedback form's scope marker, preserved beside the
  // default rendered surface (criterion 3).
  secondaryScope: string;
  // The rendered surface the reviewer selects in: the Mirror/Canonical rendered head, or
  // (for html) the sanitized copy of the raw authored bytes.
  payload: (headHtml: string, reviewText: string) => FilePayload;
};

const FORMATS: FormatCase[] = [
  {
    name: "Mirror",
    format: "md",
    path: "deliverables/memo.md",
    secondaryScope: "range",
    payload: (headHtml, reviewText) => ({
      format: "md",
      diff: [],
      sourceDiff: [],
      renderedHead: headHtml,
      reviewText,
    }),
  },
  {
    name: "Canonical",
    format: "docx",
    path: "deliverables/memo.docx",
    secondaryScope: "canonical",
    payload: (headHtml, reviewText) => ({
      format: "docx",
      renderedHead: headHtml,
      reviewText,
    }),
  },
  {
    name: "HTML",
    format: "html",
    path: "sources/report.html",
    secondaryScope: "line",
    payload: (headHtml, reviewText) => ({
      format: "html",
      raw: headHtml,
      comparisonUrl:
        "/pr/acme/reports/70/raw?path=sources%2Freport.html&ref=7070707070707070707070707070707070707070",
      reviewText,
      sourceDiff: [],
    }),
  },
];

function baseResponse(): ReviewSurfaceResponse {
  return {
    number: 70,
    title: "Make rendered annotations the production review path",
    description: "Production-path fixture",
    sourceBranchUrl: "https://github.com/acme/doc-review/tree/issue-70",
    githubUrl: "https://github.com/acme/doc-review/pull/70",
    currentRound: {
      number: 1,
      headSha: "head-70",
      createdAt: "2026-07-16T00:00:00.000Z",
      status: "open",
      comments: [],
    },
    rounds: [
      {
        number: 1,
        headSha: "head-70",
        createdAt: "2026-07-16T00:00:00.000Z",
        status: "open",
        comments: [],
      },
    ],
    files: [],
  };
}

function responseFor(
  fmt: FormatCase,
  headHtml: string,
  reviewText: string,
  comments: ReviewComment[],
): ReviewSurfaceResponse {
  const base = baseResponse();
  return {
    ...base,
    files: [
      {
        path: fmt.path,
        changeType: "modified",
        payload: fmt.payload(headHtml, reviewText),
      },
    ],
    currentRound: { ...base.currentRound, comments },
    rounds: [{ ...base.rounds[0], comments }],
  };
}

// A stored rendered-text comment for the `occurrenceIndex`-th occurrence of `quote` in
// `reviewText`, carrying the real surrounding context so it verifies (or drifts).
function makeComment(params: {
  fmt: FormatCase;
  id: string;
  quote: string;
  reviewText: string;
  occurrenceIndex?: number;
}): ReviewComment {
  const { fmt, id, quote, reviewText } = params;
  let start = reviewText.indexOf(quote);
  for (let index = 0; index < (params.occurrenceIndex ?? 0); index += 1) {
    start = reviewText.indexOf(quote, start + 1);
  }
  const end = start + quote.length;
  return {
    scope: "rendered",
    format: fmt.format,
    path: fmt.path,
    quote,
    prefix: reviewText.slice(Math.max(0, start - CONTEXT_WINDOW), start),
    suffix: reviewText.slice(end, end + CONTEXT_WINDOW),
    start,
    end,
    selectorVersion: 1,
    body: `Feedback on ${id}.`,
    id,
    headSha: "head-70",
    roundNumber: 1,
    createdAt: "2026-07-16T00:00:00.000Z",
    resolved: false,
    carriedForward: false,
    drifted: false,
  };
}

// Wraps a submitted rendered anchor with the server-owned keys, as durable round state
// would after a reload - so a remount restores the real submitted selector.
function savedFromAnchor(anchor: FeedbackAnchor, id: string): ReviewComment {
  if (anchor.scope !== "rendered") {
    throw new Error("expected a rendered anchor");
  }
  return {
    ...anchor,
    id,
    headSha: "head-70",
    roundNumber: 1,
    createdAt: "2026-07-16T00:00:00.000Z",
    resolved: false,
    carriedForward: false,
    drifted: false,
  };
}

function requiredElement<T extends Element>(
  root: Element,
  selector: string,
): T {
  const element = root.querySelector<T>(selector);
  expect(element, `Expected ${selector} to exist`).not.toBeNull();
  return element as T;
}

function editField(field: HTMLTextAreaElement, value: string): void {
  Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

function annotationMarks(root: Element): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>("mark[data-annotation-id]"),
  );
}

describe("ReviewSurfaceView production annotation path", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
    vi.restoreAllMocks();
  });

  // Renders through the production path (no injected factory) and flushes the lazy loader's
  // resolution so the adapter mounts and paints its initial highlight set.
  async function renderProduction(node: ReactElement): Promise<void> {
    await act(async () => {
      root.render(node);
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it.each(FORMATS)(
    "selects rendered text by default for a $name review copy and completes draft, submission, remount, active-state, and navigation through the production loader",
    async (fmt) => {
      const fake = createFakeRenderedAnnotator();
      loadMock.mockResolvedValue(fake.factory);
      const submitted: FeedbackAnchor[] = [];

      await renderProduction(
        <ReviewSurfaceView
          {...responseFor(fmt, HEAD_HTML, REVIEW_TEXT, [])}
          onSubmitFeedback={(anchor) => {
            submitted.push(anchor);
          }}
        />,
      );

      // The production route reached its single loader seam (no prototype query, no
      // injected factory), and the rendered surface is the default interaction: the
      // planted sentence is genuinely visible in it.
      expect(loadMock).toHaveBeenCalledTimes(1);
      const surface = requiredElement(container, "[data-annotation-surface]");
      expect(surface.textContent).toContain(PLANTED);

      // Draft: a selection becomes one painted highlight and one rail draft card.
      act(() => fake.selectText(PLANTED));
      const draft = requiredElement<HTMLFormElement>(
        container,
        "[data-annotation-draft]",
      );
      expect(
        requiredElement(draft, ".mirror-comment-card__quote").textContent,
      ).toBe(PLANTED);
      expect(annotationMarks(container)).toHaveLength(1);

      // Submission: the durable, format-stamped rendered selector crosses to the local
      // feedback callback.
      const start = REVIEW_TEXT.indexOf(PLANTED);
      const end = start + PLANTED.length;
      editField(
        requiredElement<HTMLTextAreaElement>(draft, '[name="body"]'),
        "Anchor this rendered sentence.",
      );
      act(() => {
        draft.dispatchEvent(
          new SubmitEvent("submit", { bubbles: true, cancelable: true }),
        );
      });
      expect(submitted).toEqual([
        {
          scope: "rendered",
          format: fmt.format,
          path: fmt.path,
          quote: PLANTED,
          prefix: REVIEW_TEXT.slice(Math.max(0, start - CONTEXT_WINDOW), start),
          suffix: REVIEW_TEXT.slice(end, end + CONTEXT_WINDOW),
          start,
          end,
          selectorVersion: 1,
          body: "Anchor this rendered sentence.",
        },
      ]);

      // Remount: tear the component down, then reload into a fresh root with the saved
      // comment. The card and its painted highlight return from durable state alone.
      act(() => root.unmount());
      expect(fake.destroyed).toBe(true);
      container.remove();
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);

      const saved = savedFromAnchor(submitted[0], "prod-1");
      await renderProduction(
        <ReviewSurfaceView
          {...responseFor(fmt, HEAD_HTML, REVIEW_TEXT, [saved])}
        />,
      );
      expect(container.querySelector("[data-annotation-draft]")).toBeNull();
      const mark = requiredElement<HTMLElement>(
        container,
        'mark[data-annotation-id="prod-1"]',
      );
      expect(mark.textContent).toBe(PLANTED);

      // Active-state and navigation: activating the saved card selects its own highlight.
      act(() =>
        requiredElement<HTMLButtonElement>(
          container,
          '[data-annotation-activate="prod-1"]',
        ).click(),
      );
      expect(fake.activated).toEqual(["prod-1"]);
      expect(
        requiredElement(
          container,
          '[data-annotation-comment-id="prod-1"]',
        ).getAttribute("data-active"),
      ).toBe("true");
    },
  );

  it.each(FORMATS)(
    "gives each of two same-quote $name comments its own annotation identity and matching selected state, not list order or a single active flag",
    async (fmt) => {
      const fake = createFakeRenderedAnnotator();
      loadMock.mockResolvedValue(fake.factory);
      const first = makeComment({
        fmt,
        id: "comment-a",
        quote: "Repeated claim",
        reviewText: REPEATED_REVIEW_TEXT,
        occurrenceIndex: 0,
      });
      const second = makeComment({
        fmt,
        id: "comment-b",
        quote: "Repeated claim",
        reviewText: REPEATED_REVIEW_TEXT,
        occurrenceIndex: 1,
      });

      await renderProduction(
        <ReviewSurfaceView
          {...responseFor(fmt, REPEATED_HEAD, REPEATED_REVIEW_TEXT, [
            first,
            second,
          ])}
        />,
      );

      // Two highlights, each wrapping the SAME quote at its OWN occurrence (block).
      const markA = requiredElement<HTMLElement>(
        container,
        'mark[data-annotation-id="comment-a"]',
      );
      const markB = requiredElement<HTMLElement>(
        container,
        'mark[data-annotation-id="comment-b"]',
      );
      expect(annotationMarks(container)).toHaveLength(2);
      expect(markA.closest("p")?.textContent).toContain("opening section");
      expect(markB.closest("p")?.textContent).toContain("closing section");

      const cardA = requiredElement(
        container,
        '[data-annotation-comment-id="comment-a"]',
      );
      const cardB = requiredElement(
        container,
        '[data-annotation-comment-id="comment-b"]',
      );

      // Activating A selects A's own highlight; only A's card shows selected state.
      act(() =>
        requiredElement<HTMLButtonElement>(
          cardA,
          '[data-annotation-activate="comment-a"]',
        ).click(),
      );
      expect(fake.activated).toEqual(["comment-a"]);
      expect(cardA.getAttribute("data-active")).toBe("true");
      expect(cardB.getAttribute("data-active")).toBeNull();

      // Activating B moves the unique selected state to B - no shared/global active flag.
      act(() =>
        requiredElement<HTMLButtonElement>(
          cardB,
          '[data-annotation-activate="comment-b"]',
        ).click(),
      );
      expect(fake.activated).toEqual(["comment-a", "comment-b"]);
      expect(cardB.getAttribute("data-active")).toBe("true");
      expect(cardA.getAttribute("data-active")).toBeNull();
    },
  );

  it.each(FORMATS)(
    "keeps the $name source-oriented secondary view, sandbox comparison, and whole-review feedback operable beside the default rendered surface",
    async (fmt) => {
      const fake = createFakeRenderedAnnotator();
      loadMock.mockResolvedValue(fake.factory);

      await renderProduction(
        <ReviewSurfaceView
          {...responseFor(fmt, HEAD_HTML, REVIEW_TEXT, [])}
          onSubmitFeedback={() => {}}
        />,
      );

      // The default rendered surface is present AND its source-oriented secondary feedback
      // form remains available as a secondary view.
      expect(
        container.querySelector("[data-annotation-surface]"),
      ).not.toBeNull();
      expect(
        container.querySelector(
          `[data-feedback-scope="${fmt.secondaryScope}"]`,
        ),
      ).not.toBeNull();

      // Whole-review feedback stays operable for every format.
      expect(
        container.querySelector('[data-feedback-scope="review"]'),
      ).not.toBeNull();

      // The untrusted HTML case keeps the protected exact-head response in its
      // scriptless, non-interactive sandbox for visual comparison.
      if (fmt.format === "html") {
        const iframe = requiredElement<HTMLIFrameElement>(
          container,
          "iframe.review-file__html-rendered",
        );
        expect(iframe.getAttribute("sandbox")).toBe("");
        expect(iframe.getAttribute("src")).toBe(
          "http://localhost:3000/pr/acme/reports/70/raw?path=sources%2Freport.html&ref=7070707070707070707070707070707070707070",
        );
        expect(iframe.hasAttribute("inert")).toBe(true);
      }
    },
  );

  it("invokes the annotation loader for the three supported review copies but never for PDF, download, or deleted files", async () => {
    // Supported: each rendered review copy reaches the loader exactly once.
    for (const fmt of FORMATS) {
      const fake = createFakeRenderedAnnotator();
      loadMock.mockResolvedValue(fake.factory);
      await renderProduction(
        <ReviewSurfaceView {...responseFor(fmt, HEAD_HTML, REVIEW_TEXT, [])} />,
      );
      expect(
        loadMock,
        `${fmt.name} must reach the annotation loader`,
      ).toHaveBeenCalledTimes(1);
      act(() => root.unmount());
      container.remove();
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
      loadMock.mockClear();
    }

    // Unsupported: PDF, a supporting-file download, and a deleted file (served as a
    // download payload) mount no rendered surface, so the loader is never invoked - an
    // unconditional import or loader call would fail here.
    const unsupported: {
      name: string;
      file: ReviewSurfaceResponse["files"][number];
    }[] = [
      {
        name: "PDF",
        file: {
          path: "sources/appendix.pdf",
          changeType: "modified",
          payload: { format: "pdf", blobUrl: "/appendix.pdf" },
        },
      },
      {
        name: "download",
        file: {
          path: "data/model.xlsx",
          changeType: "modified",
          payload: {
            format: "download",
            blobUrl: "/model.xlsx",
            filename: "model.xlsx",
          },
        },
      },
      {
        name: "deleted",
        file: {
          path: "deliverables/old-memo.md",
          changeType: "deleted",
          payload: {
            format: "download",
            blobUrl: "/old-memo.md",
            filename: "old-memo.md",
          },
        },
      },
    ];

    for (const { name, file } of unsupported) {
      await renderProduction(
        <ReviewSurfaceView {...baseResponse()} files={[file]} />,
      );
      expect(
        container.querySelector("[data-annotation-surface]"),
        `${name} must mount no rendered annotation surface`,
      ).toBeNull();
      expect(
        loadMock,
        `${name} must never reach the annotation loader`,
      ).not.toHaveBeenCalled();
      // PDF stays file-level: its whole-file feedback form remains, with no rendered
      // selection surface.
      if (name === "PDF") {
        expect(
          container.querySelector('[data-feedback-scope="file"]'),
        ).not.toBeNull();
      }
      act(() => root.unmount());
      container.remove();
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
      loadMock.mockClear();
    }
  });

  it.each(FORMATS)(
    "issues no external annotation-service or GitHub request across $name selection, submission, and navigation - only the local feedback callback",
    async (fmt) => {
      const fetchSpy = vi
        .spyOn(window, "fetch")
        .mockRejectedValue(new Error("no external fetch is allowed"));
      const xhrOpen = vi
        .spyOn(XMLHttpRequest.prototype, "open")
        .mockImplementation(() => {
          throw new Error("no external XHR is allowed");
        });
      const fake = createFakeRenderedAnnotator();
      loadMock.mockResolvedValue(fake.factory);
      const submitted: FeedbackAnchor[] = [];

      await renderProduction(
        <ReviewSurfaceView
          {...responseFor(fmt, HEAD_HTML, REVIEW_TEXT, [
            makeComment({
              fmt,
              id: "saved-net",
              quote: SECOND,
              reviewText: REVIEW_TEXT,
            }),
          ])}
          onSubmitFeedback={(anchor) => {
            submitted.push(anchor);
          }}
        />,
      );

      // Drive the full local interaction: select, submit, activate a saved passage.
      act(() => fake.selectText(PLANTED));
      const draft = requiredElement<HTMLFormElement>(
        container,
        "[data-annotation-draft]",
      );
      editField(
        requiredElement<HTMLTextAreaElement>(draft, '[name="body"]'),
        "No network for this.",
      );
      act(() => {
        draft.dispatchEvent(
          new SubmitEvent("submit", { bubbles: true, cancelable: true }),
        );
      });
      act(() =>
        requiredElement<HTMLButtonElement>(
          container,
          '[data-annotation-activate="saved-net"]',
        ).click(),
      );

      // The interaction stayed entirely local: the submission went to the injected
      // callback, and nothing escaped to any external annotation service or GitHub.
      expect(submitted).toHaveLength(1);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(xhrOpen).not.toHaveBeenCalled();
    },
  );
});
