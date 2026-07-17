// @vitest-environment happy-dom

import type {
  FeedbackAnchor,
  ReviewComment,
  ReviewSurfaceResponse,
} from "@doc-review/api-contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeRenderedAnnotator } from "../features/annotation/renderedAnnotator.fake";
import { ReviewSurfaceView } from "./ReviewSurfaceView";

// This suite owns mounted source-anchor behavior, not iframe transport. Keep happy-dom
// from attempting a real request when the production component resolves the comparison
// through the API origin; the jsdom HTML suite covers that URL resolution directly.
vi.mock("../shared/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/api")>()),
  resolveApiResourceUrl: () => "about:blank",
}));

const mirrorFixture: ReviewSurfaceResponse = {
  number: 44,
  title: "Polish source anchors",
  description: "Mounted interaction fixture",
  sourceBranchUrl: "https://github.com/acme/doc-review/tree/issue-44",
  githubUrl: "https://github.com/acme/doc-review/pull/52",
  currentRound: {
    number: 1,
    headSha: "head-44",
    createdAt: "2026-07-14T00:00:00.000Z",
    status: "open",
    comments: [],
  },
  rounds: [
    {
      number: 1,
      headSha: "head-44",
      createdAt: "2026-07-14T00:00:00.000Z",
      status: "open",
      comments: [],
    },
  ],
  files: [
    {
      path: "deliverables/memo.md",
      changeType: "modified",
      payload: {
        format: "md",
        diff: [],
        sourceDiff: [
          {
            oldLine: 1,
            newLine: 1,
            text: "First Mirror line\r",
            change: "context",
          },
          {
            oldLine: 2,
            newLine: 2,
            text: "Exact Mirror line",
            change: "context",
          },
        ],
        renderedHead: "<p>Mirror</p>",
        reviewText: "First Mirror line\nExact Mirror line",
      },
    },
  ],
};

const htmlFixture: ReviewSurfaceResponse = {
  ...mirrorFixture,
  files: [
    {
      path: "sources/report.html",
      changeType: "modified",
      payload: {
        format: "html",
        raw: "<main>Report</main>",
        comparisonUrl:
          "/pr/acme/reports/70/raw?path=sources%2Freport.html&ref=7070707070707070707070707070707070707070",
        reviewText: "Report",
        sourceDiff: [
          {
            oldLine: 4,
            newLine: 4,
            text: "<main>Exact HTML line</main>",
            change: "context",
          },
        ],
      },
    },
  ],
};

const multiDocumentFixture: ReviewSurfaceResponse = {
  ...htmlFixture,
  files: [
    ...htmlFixture.files,
    {
      path: "sources/appendix.pdf",
      changeType: "added",
      payload: {
        format: "pdf",
        blobUrl: "/pr/acme/board-review/44/raw?path=sources%2Fappendix.pdf",
      },
    },
  ],
};

const twoMirrorFixture: ReviewSurfaceResponse = {
  ...mirrorFixture,
  files: [
    mirrorFixture.files[0],
    {
      path: "deliverables/spec.md",
      changeType: "modified",
      payload: {
        format: "md",
        diff: [],
        sourceDiff: [
          {
            oldLine: 1,
            newLine: 1,
            text: "Spec first line",
            change: "context",
          },
          {
            oldLine: 2,
            newLine: 2,
            text: "Spec second line",
            change: "context",
          },
        ],
        renderedHead: "<p>Spec</p>",
        reviewText: "Spec first line\nSpec second line",
      },
    },
  ],
};

// A PDF-only fixture, so the file-level PDF feedback form is the active document's form
// (#89): the PDF arm carries no source anchor, only the whole-file comment.
const pdfFixture: ReviewSurfaceResponse = {
  ...mirrorFixture,
  files: [
    {
      path: "sources/appendix.pdf",
      changeType: "added",
      payload: {
        format: "pdf",
        blobUrl: "/pr/acme/doc-review/44/raw?path=sources%2Fappendix.pdf",
      },
    },
  ],
};

function requiredElement<T extends Element>(
  container: Element,
  selector: string,
): T {
  const element = container.querySelector<T>(selector);
  expect(element, `Expected ${selector} to exist`).not.toBeNull();
  return element as T;
}

function editField(
  field: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  // Assign through the prototype's native value setter, not the React-tracked
  // instance setter, so React's change tracker registers a diff and fires onChange
  // for controlled inputs (a direct `field.value = value` would update the tracker
  // and suppress the event).
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

// A promise whose resolution is deferred to the test's control, so a feedback
// submission can be held in flight (#89): while it is unresolved the form must lock,
// and only when the test settles it may the form re-enable.
function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function dispatchSubmit(form: HTMLFormElement): void {
  form.dispatchEvent(
    new SubmitEvent("submit", { bubbles: true, cancelable: true }),
  );
}

describe("ReviewSurfaceView mounted source anchors", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
  });

  it("switches from evidence to guided review and moves between changed documents", () => {
    act(() => {
      root.render(<ReviewSurfaceView {...multiDocumentFixture} />);
    });

    const evidence = requiredElement<HTMLButtonElement>(
      container,
      'button[aria-label="Use evidence review"]',
    );
    const guided = requiredElement<HTMLButtonElement>(
      container,
      'button[aria-label="Use guided review"]',
    );
    const pdf = requiredElement<HTMLButtonElement>(
      container,
      'button[aria-label="Review sources/appendix.pdf"]',
    );

    expect(evidence.getAttribute("aria-pressed")).toBe("true");
    expect(guided.getAttribute("aria-pressed")).toBe("false");
    expect(
      requiredElement(
        container,
        'button[aria-label="Review sources/report.html"]',
      ).getAttribute("aria-current"),
    ).toBe("true");

    act(() => guided.click());
    expect(guided.getAttribute("aria-pressed")).toBe("true");
    expect(evidence.getAttribute("aria-pressed")).toBe("false");
    expect(container.textContent).toContain("Step 1 of 3");

    act(() => pdf.click());
    expect(pdf.getAttribute("aria-current")).toBe("true");
    expect(container.textContent).toContain("Step 3 of 3");
    expect(container.textContent).toContain("Document 2 of 2");
  });

  it("starts guided review with the change summary before the documents", () => {
    act(() => {
      root.render(<ReviewSurfaceView {...multiDocumentFixture} />);
    });

    act(() =>
      requiredElement<HTMLButtonElement>(
        container,
        'button[aria-label="Use guided review"]',
      ).click(),
    );

    expect(container.textContent).toContain("Step 1 of 3");
    expect(container.textContent).toContain("Change summary");
    expect(container.querySelector(".review-agent-summary")).not.toBeNull();
    expect(
      requiredElement(container, ".review-document-canvas").hasAttribute(
        "hidden",
      ),
    ).toBe(true);

    act(() =>
      requiredElement<HTMLButtonElement>(
        container,
        'button[aria-label="Next review step"]',
      ).click(),
    );

    expect(container.textContent).toContain("Step 2 of 3");
    expect(container.textContent).toContain("Document 1 of 2");
    expect(
      requiredElement(container, ".review-document-canvas").hasAttribute(
        "hidden",
      ),
    ).toBe(false);
  });

  it("preserves in-progress feedback while switching review modes", () => {
    act(() => {
      root.render(<ReviewSurfaceView {...mirrorFixture} />);
    });

    const lineTwo = requiredElement<HTMLButtonElement>(
      container,
      '[data-anchor-line="2"]',
    );
    act(() => lineTwo.click());

    const form = requiredElement<HTMLFormElement>(
      container,
      '[data-feedback-scope="range"]',
    );
    editField(requiredElement(form, '[name="body"]'), "Keep this draft");

    act(() =>
      requiredElement<HTMLButtonElement>(
        container,
        'button[aria-label="Use guided review"]',
      ).click(),
    );
    act(() =>
      requiredElement<HTMLButtonElement>(
        container,
        'button[aria-label="Use evidence review"]',
      ).click(),
    );

    const restoredForm = requiredElement<HTMLFormElement>(
      container,
      '[data-feedback-scope="range"]',
    );
    expect(
      requiredElement<HTMLInputElement>(restoredForm, '[name="startLine"]')
        .value,
    ).toBe("2");
    expect(
      requiredElement<HTMLInputElement>(restoredForm, '[name="endLine"]').value,
    ).toBe("2");
    expect(
      requiredElement<HTMLTextAreaElement>(restoredForm, '[name="quote"]')
        .value,
    ).toBe("Exact Mirror line");
    expect(
      requiredElement<HTMLTextAreaElement>(restoredForm, '[name="body"]').value,
    ).toBe("Keep this draft");
  });

  it("preserves in-progress feedback while navigating away from and back to a document", () => {
    act(() => {
      root.render(<ReviewSurfaceView {...twoMirrorFixture} />);
    });

    const anchorLineTwo = () =>
      requiredElement<HTMLButtonElement>(container, '[data-anchor-line="2"]');
    const rangeForm = () =>
      requiredElement<HTMLFormElement>(
        container,
        '[data-feedback-scope="range"]',
      );

    // Draft state on document A: select a source line, then edit the quote and
    // feedback fields so both a selection-seeded field and a manual edit are at risk.
    act(() => anchorLineTwo().click());
    act(() =>
      editField(
        requiredElement(rangeForm(), '[name="quote"]'),
        "Manual quote for A",
      ),
    );
    act(() =>
      editField(
        requiredElement(rangeForm(), '[name="body"]'),
        "Draft feedback on A",
      ),
    );
    expect(anchorLineTwo().getAttribute("aria-pressed")).toBe("true");

    // Navigate A -> B; every piece of B's draft must be pristine (A does not leak).
    act(() =>
      requiredElement<HTMLButtonElement>(
        container,
        'button[aria-label="Review deliverables/spec.md"]',
      ).click(),
    );
    expect(anchorLineTwo().getAttribute("aria-pressed")).toBe("false");
    const bForm = rangeForm();
    expect(
      requiredElement<HTMLInputElement>(bForm, '[name="startLine"]').value,
    ).toBe("");
    expect(
      requiredElement<HTMLInputElement>(bForm, '[name="endLine"]').value,
    ).toBe("");
    expect(
      requiredElement<HTMLTextAreaElement>(bForm, '[name="quote"]').value,
    ).toBe("");
    expect(
      requiredElement<HTMLTextAreaElement>(bForm, '[name="body"]').value,
    ).toBe("");

    // Navigate B -> A; every piece of A's draft state must survive.
    act(() =>
      requiredElement<HTMLButtonElement>(
        container,
        'button[aria-label="Review deliverables/memo.md"]',
      ).click(),
    );

    const restoredForm = rangeForm();
    expect(anchorLineTwo().getAttribute("aria-pressed")).toBe("true");
    expect(
      requiredElement<HTMLInputElement>(restoredForm, '[name="startLine"]')
        .value,
    ).toBe("2");
    expect(
      requiredElement<HTMLInputElement>(restoredForm, '[name="endLine"]').value,
    ).toBe("2");
    expect(
      requiredElement<HTMLTextAreaElement>(restoredForm, '[name="quote"]')
        .value,
    ).toBe("Manual quote for A");
    expect(
      requiredElement<HTMLTextAreaElement>(restoredForm, '[name="body"]').value,
    ).toBe("Draft feedback on A");
  });

  it("resets in-progress feedback when a new review head arrives", () => {
    act(() => {
      root.render(<ReviewSurfaceView {...mirrorFixture} />);
    });

    const anchorLineTwo = () =>
      requiredElement<HTMLButtonElement>(container, '[data-anchor-line="2"]');
    const rangeForm = () =>
      requiredElement<HTMLFormElement>(
        container,
        '[data-feedback-scope="range"]',
      );

    // Draft state under the first head.
    act(() => anchorLineTwo().click());
    act(() =>
      editField(
        requiredElement(rangeForm(), '[name="body"]'),
        "Draft against the old head",
      ),
    );
    expect(anchorLineTwo().getAttribute("aria-pressed")).toBe("true");

    // A new round opens on a fresh head; every document must start pristine, since
    // a retained draft would point at stale, superseded content.
    const nextHead = "head-45";
    act(() => {
      root.render(
        <ReviewSurfaceView
          {...mirrorFixture}
          currentRound={{ ...mirrorFixture.currentRound, headSha: nextHead }}
          rounds={[
            ...mirrorFixture.rounds,
            {
              number: 2,
              headSha: nextHead,
              createdAt: "2026-07-16T00:00:00.000Z",
              status: "open",
              comments: [],
            },
          ]}
        />,
      );
    });

    const pristineForm = rangeForm();
    expect(anchorLineTwo().getAttribute("aria-pressed")).toBe("false");
    expect(
      requiredElement<HTMLInputElement>(pristineForm, '[name="startLine"]')
        .value,
    ).toBe("");
    expect(
      requiredElement<HTMLInputElement>(pristineForm, '[name="endLine"]').value,
    ).toBe("");
    expect(
      requiredElement<HTMLTextAreaElement>(pristineForm, '[name="quote"]')
        .value,
    ).toBe("");
    expect(
      requiredElement<HTMLTextAreaElement>(pristineForm, '[name="body"]').value,
    ).toBe("");
  });

  it("restores the selected Mirror anchor before submitting after same-line reselection", () => {
    const submitted: FeedbackAnchor[] = [];

    act(() => {
      root.render(
        <ReviewSurfaceView
          {...mirrorFixture}
          onSubmitFeedback={(anchor) => {
            submitted.push(anchor);
          }}
        />,
      );
    });

    const form = requiredElement<HTMLFormElement>(
      container,
      '[data-feedback-scope="range"]',
    );
    const lineTwo = requiredElement<HTMLButtonElement>(
      container,
      '[data-anchor-line="2"]',
    );

    act(() => lineTwo.click());
    editField(requiredElement(form, '[name="startLine"]'), "1");
    editField(requiredElement(form, '[name="endLine"]'), "999");
    editField(requiredElement(form, '[name="quote"]'), "Stale manual quote");
    editField(requiredElement(form, '[name="body"]'), "Review this line");

    act(() => lineTwo.click());
    act(() => {
      form.dispatchEvent(
        new SubmitEvent("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(submitted).toEqual([
      {
        scope: "range",
        path: "deliverables/memo.md",
        startLine: 2,
        endLine: 2,
        quote: "Exact Mirror line",
        body: "Review this line",
      },
    ]);
  });

  it("normalizes a reverse Mirror range and starts a new selection after completion", () => {
    const submitted: FeedbackAnchor[] = [];

    act(() => {
      root.render(
        <ReviewSurfaceView
          {...mirrorFixture}
          onSubmitFeedback={(anchor) => {
            submitted.push(anchor);
          }}
        />,
      );
    });

    const form = requiredElement<HTMLFormElement>(
      container,
      '[data-feedback-scope="range"]',
    );
    const lineOne = requiredElement<HTMLButtonElement>(
      container,
      '[data-anchor-line="1"]',
    );
    const lineTwo = requiredElement<HTMLButtonElement>(
      container,
      '[data-anchor-line="2"]',
    );
    editField(requiredElement(form, '[name="body"]'), "Review selection");

    act(() => lineTwo.click());
    act(() => lineOne.click());
    act(() => {
      form.dispatchEvent(
        new SubmitEvent("submit", { bubbles: true, cancelable: true }),
      );
    });

    act(() => lineTwo.click());
    act(() => {
      form.dispatchEvent(
        new SubmitEvent("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(submitted).toEqual([
      {
        scope: "range",
        path: "deliverables/memo.md",
        startLine: 1,
        endLine: 2,
        quote: "First Mirror line\nExact Mirror line",
        body: "Review selection",
      },
      {
        scope: "range",
        path: "deliverables/memo.md",
        startLine: 2,
        endLine: 2,
        quote: "Exact Mirror line",
        body: "Review selection",
      },
    ]);
  });

  it("restores the selected HTML anchor before submitting after same-line reselection", () => {
    const submitted: FeedbackAnchor[] = [];

    act(() => {
      root.render(
        <ReviewSurfaceView
          {...htmlFixture}
          onSubmitFeedback={(anchor) => {
            submitted.push(anchor);
          }}
        />,
      );
    });

    const form = requiredElement<HTMLFormElement>(
      container,
      '[data-feedback-scope="line"]',
    );
    const lineFour = requiredElement<HTMLButtonElement>(
      container,
      '[data-anchor-line="4"]',
    );

    act(() => lineFour.click());
    editField(requiredElement(form, '[name="line"]'), "999");
    editField(requiredElement(form, '[name="quote"]'), "Stale HTML quote");
    editField(requiredElement(form, '[name="body"]'), "Review this markup");

    act(() => lineFour.click());
    act(() => {
      form.dispatchEvent(
        new SubmitEvent("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(submitted).toEqual([
      {
        scope: "line",
        path: "sources/report.html",
        line: 4,
        quote: "<main>Exact HTML line</main>",
        body: "Review this markup",
      },
    ]);
  });

  it("locks the Mirror range form while a submission is in flight, ignoring a second submit", () => {
    const inFlight = createDeferred<void>();
    const onSubmitFeedback = vi.fn(() => inFlight.promise);

    act(() => {
      root.render(
        <ReviewSurfaceView
          {...mirrorFixture}
          onSubmitFeedback={onSubmitFeedback}
        />,
      );
    });

    const form = requiredElement<HTMLFormElement>(
      container,
      '[data-feedback-scope="range"]',
    );
    const button = requiredElement<HTMLButtonElement>(
      form,
      'button[type="submit"]',
    );

    act(() => dispatchSubmit(form));
    expect(onSubmitFeedback).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);

    // A second submit (double-click or double Enter) while the first is still
    // unresolved must fire no second call and keep the button disabled.
    act(() => dispatchSubmit(form));
    expect(onSubmitFeedback).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
  });

  it("re-enables the Mirror range form after a failed submission so a retry fires a second call", async () => {
    const first = createDeferred<void>();
    const onSubmitFeedback = vi.fn(() => Promise.resolve());
    onSubmitFeedback.mockReturnValueOnce(first.promise);

    act(() => {
      root.render(
        <ReviewSurfaceView
          {...mirrorFixture}
          onSubmitFeedback={onSubmitFeedback}
        />,
      );
    });

    const form = requiredElement<HTMLFormElement>(
      container,
      '[data-feedback-scope="range"]',
    );
    const button = requiredElement<HTMLButtonElement>(
      form,
      'button[type="submit"]',
    );

    act(() => dispatchSubmit(form));
    expect(onSubmitFeedback).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);

    // The first submission rejects; once it settles the form re-enables so the write
    // can be retried (the page owns durable-write reporting; the form only re-enables).
    await act(async () => {
      first.reject(new Error("submit failed"));
      await Promise.resolve();
    });
    expect(button.disabled).toBe(false);

    // The retry fires a second call.
    await act(async () => {
      dispatchSubmit(form);
      await Promise.resolve();
    });
    expect(onSubmitFeedback).toHaveBeenCalledTimes(2);
  });

  it("locks the whole-review form while a submission is in flight, ignoring a second submit", () => {
    const inFlight = createDeferred<void>();
    const onSubmitFeedback = vi.fn(() => inFlight.promise);

    act(() => {
      root.render(
        <ReviewSurfaceView
          {...mirrorFixture}
          onSubmitFeedback={onSubmitFeedback}
        />,
      );
    });

    const form = requiredElement<HTMLFormElement>(
      container,
      '[data-feedback-scope="review"]',
    );
    const button = requiredElement<HTMLButtonElement>(
      form,
      'button[type="submit"]',
    );

    act(() => dispatchSubmit(form));
    expect(onSubmitFeedback).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);

    act(() => dispatchSubmit(form));
    expect(onSubmitFeedback).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
  });

  it("locks the PDF feedback form while a submission is in flight, ignoring a second submit", () => {
    const inFlight = createDeferred<void>();
    const onSubmitFeedback = vi.fn(() => inFlight.promise);

    act(() => {
      root.render(
        <ReviewSurfaceView
          {...pdfFixture}
          onSubmitFeedback={onSubmitFeedback}
        />,
      );
    });

    const form = requiredElement<HTMLFormElement>(
      container,
      '[data-feedback-scope="file"]',
    );
    const button = requiredElement<HTMLButtonElement>(
      form,
      'button[type="submit"]',
    );

    act(() => dispatchSubmit(form));
    expect(onSubmitFeedback).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);

    act(() => dispatchSubmit(form));
    expect(onSubmitFeedback).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
  });
});

// Honest rendered-Mirror fixture: the rendered head HTML and the normalized review-text
// describe the SAME document, so a planted sentence is genuinely visible in the mounted
// surface (not only present in the review-text). container.textContent concatenates the
// block texts, so every planted sentence is a contiguous, selectable substring.
const annotationRenderedHead =
  "<h2>Scope</h2>" +
  "<p>Intro paragraph about scope.</p>" +
  "<p>The Bandersnatch metric holds firm across revisions.</p>" +
  "<p>Closing note.</p>";
const annotationReviewText =
  "Scope\n\nIntro paragraph about scope.\n\nThe Bandersnatch metric holds firm across revisions.\n\nClosing note.";
const plantedSentence = "The Bandersnatch metric holds firm across revisions.";
const plantedStart = annotationReviewText.indexOf(plantedSentence);
const plantedEnd = plantedStart + plantedSentence.length;

// A repeated-quote document: the same quote appears in two blocks, each with enough
// distinct in-block context that quote+context locates its own occurrence in the
// rendered document (whose textContent concatenates the blocks) without relying on any
// cross-text position or index.
const repeatedRenderedHead =
  "<p>The opening section clearly states Repeated claim as its own central and firmly held point here.</p>" +
  "<p>Much further down the closing section again states Repeated claim to reinforce that same earlier point.</p>";
const repeatedReviewText =
  "The opening section clearly states Repeated claim as its own central and firmly held point here.\n\nMuch further down the closing section again states Repeated claim to reinforce that same earlier point.";

function withDocument(
  renderedHead: string,
  reviewText: string,
  comments: ReviewComment[],
  sourceLine = "Intro paragraph about scope.",
): ReviewSurfaceResponse {
  return {
    ...mirrorFixture,
    files: [
      {
        path: "deliverables/memo.md",
        changeType: "modified",
        payload: {
          format: "md",
          diff: [],
          sourceDiff: [
            { oldLine: 1, newLine: 1, text: sourceLine, change: "context" },
          ],
          renderedHead,
          reviewText,
        },
      },
    ],
    currentRound: { ...mirrorFixture.currentRound, comments },
    rounds: [{ ...mirrorFixture.rounds[0], comments }],
  };
}

const annotationFixture = withDocument(
  annotationRenderedHead,
  annotationReviewText,
  [],
);

// A stored rendered-text comment for the `occurrenceIndex`-th occurrence of `quote` in
// `reviewText`, carrying the real surrounding context so it verifies (or drifts).
function makeRenderedComment(params: {
  reviewText: string;
  id: string;
  quote: string;
  occurrenceIndex?: number;
  drifted?: boolean;
  carriedForward?: boolean;
}): ReviewComment {
  const { reviewText, id, quote } = params;
  let start = reviewText.indexOf(quote);
  for (let index = 0; index < (params.occurrenceIndex ?? 0); index += 1) {
    start = reviewText.indexOf(quote, start + 1);
  }
  const end = start + quote.length;
  return {
    scope: "rendered",
    format: "md",
    path: "deliverables/memo.md",
    quote,
    prefix: reviewText.slice(Math.max(0, start - 32), start),
    suffix: reviewText.slice(end, end + 32),
    start,
    end,
    selectorVersion: 1,
    body: `Feedback on ${id}.`,
    id,
    headSha: "head-44",
    roundNumber: 1,
    createdAt: "2026-07-14T00:00:00.000Z",
    resolved: false,
    carriedForward: params.carriedForward ?? false,
    drifted: params.drifted ?? false,
  };
}

function annotationMarks(root: Element): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>("mark[data-annotation-id]"),
  );
}

describe("ReviewSurfaceView rendered Mirror annotation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
  });

  it("turns a selection made in the rendered surface into one painted highlight and one draft card", () => {
    const annotator = createFakeRenderedAnnotator();

    act(() => {
      root.render(
        <ReviewSurfaceView
          {...annotationFixture}
          annotatorFactory={annotator.factory}
        />,
      );
    });

    // The planted sentence is genuinely visible in the rendered surface, then selected.
    const surface = requiredElement(container, "[data-annotation-surface]");
    expect(surface.textContent).toContain(plantedSentence);
    act(() => annotator.selectText(plantedSentence));

    // One draft rail card showing that exact sentence.
    const draft = requiredElement(container, "[data-annotation-draft]");
    expect(
      requiredElement(draft, ".mirror-comment-card__quote").textContent,
    ).toBe(plantedSentence);

    // Exactly one visible highlight, painted as a real DOM element wrapping the passage.
    const marks = annotationMarks(container);
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe(plantedSentence);

    // The highlight crossed the seam as a plain, context-addressed doc-review shape.
    expect(annotator.lastHighlights()).toHaveLength(1);
    expect(annotator.lastHighlights()[0]).toMatchObject({
      quote: plantedSentence,
    });
  });

  it("fires the rendered-annotation draft submission once on a double submit, unmounting the draft", () => {
    const annotator = createFakeRenderedAnnotator();
    const onSubmitFeedback = vi.fn();

    act(() => {
      root.render(
        <ReviewSurfaceView
          {...annotationFixture}
          annotatorFactory={annotator.factory}
          onSubmitFeedback={onSubmitFeedback}
        />,
      );
    });

    act(() => annotator.selectText(plantedSentence));
    const draftForm = requiredElement<HTMLFormElement>(
      container,
      "[data-annotation-draft]",
    );
    editField(requiredElement(draftForm, '[name="body"]'), "Comment once");

    act(() => {
      draftForm.dispatchEvent(
        new SubmitEvent("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(onSubmitFeedback).toHaveBeenCalledTimes(1);
    // The draft card unmounts its form on submit, so a second submit has no target -
    // the single-fire lock this scope relies on instead of a disabled state (#89).
    expect(container.querySelector("[data-annotation-draft]")).toBeNull();

    act(() => {
      draftForm.dispatchEvent(
        new SubmitEvent("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(onSubmitFeedback).toHaveBeenCalledTimes(1);
  });

  it("submits the doc-review selector with distinct prefix, suffix, start, and end", () => {
    const annotator = createFakeRenderedAnnotator();
    const submitted: FeedbackAnchor[] = [];

    act(() => {
      root.render(
        <ReviewSurfaceView
          {...annotationFixture}
          annotatorFactory={annotator.factory}
          onSubmitFeedback={(anchor) => {
            submitted.push(anchor);
          }}
        />,
      );
    });

    act(() => annotator.selectText(plantedSentence));
    const draftForm = requiredElement<HTMLFormElement>(
      container,
      "[data-annotation-draft]",
    );
    editField(
      requiredElement(draftForm, '[name="body"]'),
      "Tie this claim to the rendered text.",
    );
    act(() => {
      draftForm.dispatchEvent(
        new SubmitEvent("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(submitted).toEqual([
      {
        scope: "rendered",
        format: "md",
        path: "deliverables/memo.md",
        quote: plantedSentence,
        prefix: annotationReviewText.slice(
          Math.max(0, plantedStart - 32),
          plantedStart,
        ),
        suffix: annotationReviewText.slice(plantedEnd, plantedEnd + 32),
        start: plantedStart,
        end: plantedEnd,
        selectorVersion: 1,
        body: "Tie this claim to the rendered text.",
      },
    ]);
  });

  it("submits a distinct selector for a different planted sentence", () => {
    const annotator = createFakeRenderedAnnotator();
    const submitted: FeedbackAnchor[] = [];

    act(() => {
      root.render(
        <ReviewSurfaceView
          {...annotationFixture}
          annotatorFactory={annotator.factory}
          onSubmitFeedback={(anchor) => {
            submitted.push(anchor);
          }}
        />,
      );
    });

    const secondSentence = "Intro paragraph about scope.";
    const secondStart = annotationReviewText.indexOf(secondSentence);
    const secondEnd = secondStart + secondSentence.length;

    act(() => annotator.selectText(secondSentence));
    const draftForm = requiredElement<HTMLFormElement>(
      container,
      "[data-annotation-draft]",
    );
    editField(
      requiredElement(draftForm, '[name="body"]'),
      "Anchor the intro sentence.",
    );
    act(() => {
      draftForm.dispatchEvent(
        new SubmitEvent("submit", { bubbles: true, cancelable: true }),
      );
    });

    // A different sentence yields its own distinct selector - not replayed values.
    expect(secondStart).not.toBe(plantedStart);
    expect(submitted).toEqual([
      {
        scope: "rendered",
        format: "md",
        path: "deliverables/memo.md",
        quote: secondSentence,
        prefix: annotationReviewText.slice(
          Math.max(0, secondStart - 32),
          secondStart,
        ),
        suffix: annotationReviewText.slice(secondEnd, secondEnd + 32),
        start: secondStart,
        end: secondEnd,
        selectorVersion: 1,
        body: "Anchor the intro sentence.",
      },
    ]);
  });

  it("restores the saved card and painted highlight after a genuine unmount and remount", () => {
    const annotator = createFakeRenderedAnnotator();
    const submitted: FeedbackAnchor[] = [];

    act(() => {
      root.render(
        <ReviewSurfaceView
          {...annotationFixture}
          annotatorFactory={annotator.factory}
          onSubmitFeedback={(anchor) => {
            submitted.push(anchor);
          }}
        />,
      );
    });

    act(() => annotator.selectText(plantedSentence));
    const draftForm = requiredElement<HTMLFormElement>(
      container,
      "[data-annotation-draft]",
    );
    editField(requiredElement(draftForm, '[name="body"]'), "Persist me.");
    act(() => {
      draftForm.dispatchEvent(
        new SubmitEvent("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(submitted).toHaveLength(1);

    // Genuinely tear the component down: its React state (draft, active id, mounted
    // adapter) is gone. Only durable round state can restore anything.
    act(() => root.unmount());
    expect(annotator.destroyed).toBe(true);
    container.remove();

    // Reload into a fresh root and container, with the refreshed round now carrying
    // the saved comment.
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const saved = makeRenderedComment({
      reviewText: annotationReviewText,
      id: "saved-1",
      quote: plantedSentence,
    });
    act(() => {
      root.render(
        <ReviewSurfaceView
          {...withDocument(annotationRenderedHead, annotationReviewText, [
            saved,
          ])}
          annotatorFactory={annotator.factory}
        />,
      );
    });

    // No draft leaked; the saved card and its painted highlight come back from durable
    // state alone.
    expect(container.querySelector("[data-annotation-draft]")).toBeNull();
    const card = requiredElement(
      container,
      '[data-annotation-comment-id="saved-1"]',
    );
    expect(
      requiredElement(card, ".mirror-comment-card__quote").textContent,
    ).toBe(plantedSentence);
    const marks = annotationMarks(container);
    expect(marks).toHaveLength(1);
    expect(marks[0].getAttribute("data-annotation-id")).toBe("saved-1");
    expect(marks[0].textContent).toBe(plantedSentence);
  });

  it("activates and paints each same-quote comment at its own occurrence, not a shared one", () => {
    const annotator = createFakeRenderedAnnotator();
    const first = makeRenderedComment({
      reviewText: repeatedReviewText,
      id: "comment-a",
      quote: "Repeated claim",
      occurrenceIndex: 0,
    });
    const second = makeRenderedComment({
      reviewText: repeatedReviewText,
      id: "comment-b",
      quote: "Repeated claim",
      occurrenceIndex: 1,
    });

    act(() => {
      root.render(
        <ReviewSurfaceView
          {...withDocument(repeatedRenderedHead, repeatedReviewText, [
            first,
            second,
          ])}
          annotatorFactory={annotator.factory}
        />,
      );
    });

    // Two highlights, each wrapping the SAME quote but at its OWN occurrence (block).
    const markA = requiredElement<HTMLElement>(
      container,
      'mark[data-annotation-id="comment-a"]',
    );
    const markB = requiredElement<HTMLElement>(
      container,
      'mark[data-annotation-id="comment-b"]',
    );
    expect(annotationMarks(container)).toHaveLength(2);
    expect(markA.textContent).toBe("Repeated claim");
    expect(markB.textContent).toBe("Repeated claim");
    expect(markA.closest("p")?.textContent).toContain("opening section");
    expect(markB.closest("p")?.textContent).toContain("closing section");

    // Activating each card selects its own highlight - identity is not hard-coded.
    act(() =>
      requiredElement<HTMLButtonElement>(
        container,
        '[data-annotation-activate="comment-a"]',
      ).click(),
    );
    act(() =>
      requiredElement<HTMLButtonElement>(
        container,
        '[data-annotation-activate="comment-b"]',
      ).click(),
    );
    expect(annotator.activated).toEqual(["comment-a", "comment-b"]);
  });

  it("keeps a drifted comment's quote in the rail but paints no highlight for it", () => {
    const annotator = createFakeRenderedAnnotator();
    const verified = makeRenderedComment({
      reviewText: annotationReviewText,
      id: "verified-1",
      quote: plantedSentence,
    });
    const drifted = makeRenderedComment({
      reviewText: annotationReviewText,
      id: "drifted-1",
      quote: "Intro paragraph about scope.",
      drifted: true,
    });

    act(() => {
      root.render(
        <ReviewSurfaceView
          {...withDocument(annotationRenderedHead, annotationReviewText, [
            verified,
            drifted,
          ])}
          annotatorFactory={annotator.factory}
        />,
      );
    });

    // Both comments keep their quote in the rail.
    expect(
      requiredElement(
        container,
        '[data-annotation-comment-id="verified-1"] .mirror-comment-card__quote',
      ).textContent,
    ).toBe(plantedSentence);
    const driftedCard = requiredElement(
      container,
      '[data-annotation-comment-id="drifted-1"]',
    );
    expect(driftedCard.getAttribute("data-annotation-painted")).toBe("false");
    expect(driftedCard.querySelector("[data-annotation-activate]")).toBeNull();

    // Only the verified comment is painted; the drifted position gets no highlight.
    const marks = annotationMarks(container);
    expect(marks).toHaveLength(1);
    expect(marks[0].getAttribute("data-annotation-id")).toBe("verified-1");
    expect(marks[0].textContent).toBe(plantedSentence);
  });

  it("presents a verified-but-unpainted comment like a drifted one - no dead affordance", () => {
    const annotator = createFakeRenderedAnnotator();
    // The review-text carries a sentence the rendered head does NOT contain, so the
    // comment verifies against the review-text but fails closed when the adapter tries
    // to locate it in the independently-derived rendered document.
    const reviewTextWithGhost =
      annotationReviewText +
      "\n\nThis sentence lives only in the review text and not the rendered head.";
    const ghost = makeRenderedComment({
      reviewText: reviewTextWithGhost,
      id: "ghost-1",
      quote:
        "This sentence lives only in the review text and not the rendered head.",
    });

    act(() => {
      root.render(
        <ReviewSurfaceView
          {...withDocument(annotationRenderedHead, reviewTextWithGhost, [
            ghost,
          ])}
          annotatorFactory={annotator.factory}
        />,
      );
    });

    // The card keeps its quote but offers no navigation to a highlight never drawn.
    const card = requiredElement(
      container,
      '[data-annotation-comment-id="ghost-1"]',
    );
    expect(card.getAttribute("data-annotation-painted")).toBe("false");
    expect(card.querySelector("[data-annotation-activate]")).toBeNull();
    expect(annotationMarks(container)).toHaveLength(0);
  });

  // #69 criterion 6: after a round transition the server owns each carried comment's drift
  // state and reattached position. A verified carried comment restores its highlight and its
  // navigation target; a drifted carried comment shows its original quote and context, draws
  // no highlight, and stays resolvable through the retained-feedback rail.
  it("restores a highlight and navigation for a verified carried comment while a drifted carried comment shows its quote, paints nothing, and stays resolvable", () => {
    const annotator = createFakeRenderedAnnotator();
    const resolved: string[] = [];
    // The verified comment's server-owned span points at the current review-text location
    // (the reattachment the server verified); the drifted comment is server-marked drifted.
    const verified = makeRenderedComment({
      reviewText: annotationReviewText,
      id: "carried-verified-6",
      quote: plantedSentence,
      carriedForward: true,
    });
    const drifted = makeRenderedComment({
      reviewText: annotationReviewText,
      id: "carried-drifted-6",
      quote: "Intro paragraph about scope.",
      carriedForward: true,
      drifted: true,
    });

    act(() => {
      root.render(
        <ReviewSurfaceView
          {...withDocument(annotationRenderedHead, annotationReviewText, [
            verified,
            drifted,
          ])}
          annotatorFactory={annotator.factory}
          onResolve={(id) => {
            resolved.push(id);
          }}
        />,
      );
    });

    // The verified carried comment restores its highlight and a navigation target.
    const verifiedCard = requiredElement(
      container,
      '[data-annotation-comment-id="carried-verified-6"]',
    );
    expect(verifiedCard.getAttribute("data-annotation-painted")).toBe("true");
    expect(
      requiredElement(verifiedCard, ".mirror-comment-card__quote").textContent,
    ).toBe(plantedSentence);
    expect(
      verifiedCard.querySelector(
        '[data-annotation-activate="carried-verified-6"]',
      ),
    ).not.toBeNull();
    const marks = annotationMarks(container);
    expect(marks).toHaveLength(1);
    expect(marks[0].getAttribute("data-annotation-id")).toBe(
      "carried-verified-6",
    );

    // The drifted carried comment keeps its original quote, draws no highlight, and offers
    // no navigation to a passage that was never painted.
    const driftedCard = requiredElement(
      container,
      '[data-annotation-comment-id="carried-drifted-6"]',
    );
    expect(driftedCard.getAttribute("data-annotation-painted")).toBe("false");
    expect(
      requiredElement(driftedCard, ".mirror-comment-card__quote").textContent,
    ).toBe("Intro paragraph about scope.");
    expect(driftedCard.querySelector("[data-annotation-activate]")).toBeNull();

    // The drifted comment remains resolvable: the retained-feedback rail flags it drifted and
    // still offers a Resolve action wired to the server.
    const driftedFeedback = requiredElement(
      container,
      '[data-comment-id="carried-drifted-6"]',
    );
    expect(driftedFeedback.getAttribute("data-drifted")).toBe("true");
    const resolveButton = requiredElement<HTMLButtonElement>(
      driftedFeedback,
      '[data-round-action="resolve"]',
    );
    act(() => resolveButton.click());
    expect(resolved).toEqual(["carried-drifted-6"]);
  });

  // #69 criterion 6 (boundary-moved variant): a comment that once began the document (empty
  // prefix, a document-start boundary claim) sits mid-document after content is prepended.
  // The server now drifts it (the boundary claim no longer holds) rather than reattaching it
  // to a location the client would refuse to paint, so it arrives drifted and presents
  // consistently: its quote in the rail, no highlight, no navigation, and still resolvable.
  it("presents a reconciled boundary-moved comment consistently: drifted, quote shown, no highlight, resolvable", () => {
    const annotator = createFakeRenderedAnnotator();
    const resolved: string[] = [];
    // An empty prefix is a document-start claim, yet the stored span now sits mid-document
    // (plantedStart > 0). The reconciled server marks it drifted.
    expect(plantedStart).toBeGreaterThan(0);
    const boundaryMoved: ReviewComment = {
      scope: "rendered",
      format: "md",
      path: "deliverables/memo.md",
      quote: plantedSentence,
      prefix: "",
      suffix: annotationReviewText.slice(plantedEnd, plantedEnd + 32),
      start: plantedStart,
      end: plantedEnd,
      selectorVersion: 1,
      body: "Feedback that once began the document.",
      id: "boundary-moved-6",
      headSha: "head-44",
      roundNumber: 1,
      createdAt: "2026-07-16T00:00:00.000Z",
      resolved: false,
      carriedForward: true,
      drifted: true,
    };

    act(() => {
      root.render(
        <ReviewSurfaceView
          {...withDocument(annotationRenderedHead, annotationReviewText, [
            boundaryMoved,
          ])}
          annotatorFactory={annotator.factory}
          onResolve={(id) => {
            resolved.push(id);
          }}
        />,
      );
    });

    // The card keeps its original quote, draws no highlight, and offers no navigation.
    const card = requiredElement(
      container,
      '[data-annotation-comment-id="boundary-moved-6"]',
    );
    expect(
      requiredElement(card, ".mirror-comment-card__quote").textContent,
    ).toBe(plantedSentence);
    expect(card.getAttribute("data-annotation-painted")).toBe("false");
    expect(card.querySelector("[data-annotation-activate]")).toBeNull();
    expect(annotationMarks(container)).toHaveLength(0);

    // It stays resolvable: the retained-feedback rail flags it drifted and offers Resolve.
    const feedback = requiredElement(
      container,
      '[data-comment-id="boundary-moved-6"]',
    );
    expect(feedback.getAttribute("data-drifted")).toBe("true");
    act(() =>
      requiredElement<HTMLButtonElement>(
        feedback,
        '[data-round-action="resolve"]',
      ).click(),
    );
    expect(resolved).toEqual(["boundary-moved-6"]);
  });

  it("re-runs paint on a recreated adapter when only the factory changes", () => {
    const saved = makeRenderedComment({
      reviewText: annotationReviewText,
      id: "saved-1",
      quote: plantedSentence,
    });
    // EVERYTHING except the adapter factory is held identical across both renders - same
    // rendered head, same review-text, same comments array (so highlights identity is
    // stable). Only the factory changes, isolating the paint/adapter recoupling.
    const doc = withDocument(annotationRenderedHead, annotationReviewText, [
      saved,
    ]);

    const first = createFakeRenderedAnnotator();
    act(() => {
      root.render(
        <ReviewSurfaceView {...doc} annotatorFactory={first.factory} />,
      );
    });
    expect(first.highlightCalls.length).toBeGreaterThan(0);
    expect(
      requiredElement(
        container,
        '[data-annotation-comment-id="saved-1"]',
      ).getAttribute("data-annotation-painted"),
    ).toBe("true");

    // Only the factory changes. The paint effect must re-run on the NEW adapter (the old
    // ready-boolean coupling would batch to no-change and never call the new adapter),
    // so the recreated adapter receives the paint and the first is destroyed.
    const second = createFakeRenderedAnnotator();
    act(() => {
      root.render(
        <ReviewSurfaceView {...doc} annotatorFactory={second.factory} />,
      );
    });
    expect(first.destroyed).toBe(true);
    expect(second.highlightCalls.length).toBeGreaterThan(0);
    // Still painted - now by the recreated adapter's own mark, keyed to that instance.
    const card = requiredElement(
      container,
      '[data-annotation-comment-id="saved-1"]',
    );
    expect(card.getAttribute("data-annotation-painted")).toBe("true");
    expect(
      container.querySelector('mark[data-annotation-id="saved-1"]'),
    ).not.toBeNull();
  });

  it("survives a co-change commit (review-text and comments change together)", () => {
    const savedA = makeRenderedComment({
      reviewText: annotationReviewText,
      id: "a-1",
      quote: plantedSentence,
    });
    const firstFactory = createFakeRenderedAnnotator();
    act(() => {
      root.render(
        <ReviewSurfaceView
          {...withDocument(annotationRenderedHead, annotationReviewText, [
            savedA,
          ])}
          annotatorFactory={firstFactory.factory}
        />,
      );
    });
    expect(
      requiredElement(
        container,
        '[data-annotation-comment-id="a-1"]',
      ).getAttribute("data-annotation-painted"),
    ).toBe("true");

    // Review-text AND comments change in the same commit. React runs the old adapter's
    // cleanup (destroy) before a still-pending paint effect that closed over it - the
    // adapter's destroyed-guard keeps that stale paint from throwing, and the new adapter
    // paints the new state.
    const savedB = makeRenderedComment({
      reviewText: repeatedReviewText,
      id: "b-1",
      quote: "Repeated claim",
      occurrenceIndex: 0,
    });
    const secondFactory = createFakeRenderedAnnotator();
    expect(() => {
      act(() => {
        root.render(
          <ReviewSurfaceView
            {...withDocument(repeatedRenderedHead, repeatedReviewText, [
              savedB,
            ])}
            annotatorFactory={secondFactory.factory}
          />,
        );
      });
    }).not.toThrow();

    expect(
      container.querySelector('[data-annotation-comment-id="a-1"]'),
    ).toBeNull();
    const cardB = requiredElement(
      container,
      '[data-annotation-comment-id="b-1"]',
    );
    expect(cardB.getAttribute("data-annotation-painted")).toBe("true");
    expect(
      container.querySelector('mark[data-annotation-id="b-1"]'),
    ).not.toBeNull();
  });

  it("keeps source-range, review-level, and round controls operable with annotation mounted", () => {
    const annotator = createFakeRenderedAnnotator();
    const submitted: FeedbackAnchor[] = [];
    let finished = 0;

    act(() => {
      root.render(
        <ReviewSurfaceView
          {...annotationFixture}
          annotatorFactory={annotator.factory}
          onSubmitFeedback={(anchor) => {
            submitted.push(anchor);
          }}
          onFinish={() => {
            finished += 1;
          }}
        />,
      );
    });

    // Mirror source-range feedback still works end to end: pick a head line, fill the
    // body, submit.
    act(() =>
      requiredElement<HTMLButtonElement>(
        container,
        '[data-anchor-line="1"]',
      ).click(),
    );
    const rangeForm = requiredElement<HTMLFormElement>(
      container,
      '[data-feedback-scope="range"]',
    );
    editField(
      requiredElement(rangeForm, '[name="body"]'),
      "Source range still works",
    );
    act(() => {
      rangeForm.dispatchEvent(
        new SubmitEvent("submit", { bubbles: true, cancelable: true }),
      );
    });

    // Review-level feedback still works.
    const reviewForm = requiredElement<HTMLFormElement>(
      container,
      '[data-feedback-scope="review"]',
    );
    editField(
      requiredElement(reviewForm, '[name="body"]'),
      "Whole review still works",
    );
    act(() => {
      reviewForm.dispatchEvent(
        new SubmitEvent("submit", { bubbles: true, cancelable: true }),
      );
    });

    // The round control still fires its handler.
    const finishForm = requiredElement<HTMLButtonElement>(
      container,
      '[data-round-action="finish"]',
    ).closest("form");
    act(() => {
      finishForm?.dispatchEvent(
        new SubmitEvent("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(submitted).toEqual([
      {
        scope: "range",
        path: "deliverables/memo.md",
        startLine: 1,
        endLine: 1,
        quote: "Intro paragraph about scope.",
        body: "Source range still works",
      },
      { scope: "review", body: "Whole review still works" },
    ]);
    expect(finished).toBe(1);
  });
});
