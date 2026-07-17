// @vitest-environment happy-dom
//
// The rendered Canonical annotation lifecycle (#67): a rendered Canonical (.docx, converted
// to HTML server-side by mammoth) joins the SAME production annotation adapter and durable
// feedback lifecycle as the Mirror (#64) and sanitized HTML (#66). The mammoth HTML is
// trusted server output, so - like the Mirror and unlike the untrusted HTML arm - it mounts
// directly with no client-side sanitize; this suite therefore runs on the repo-default
// happy-dom (no DOMPurify walk is exercised). Every case injects the in-memory fake adapter
// (so no Recogito chunk loads) and drives selection, submission, remount, and navigation as
// real DOM interactions in the mounted rendered Canonical.

import type {
  FeedbackAnchor,
  ReviewComment,
  ReviewSurfaceResponse,
} from "@doc-review/api-contracts";
import { readFileSync } from "node:fs";
// Node's URL/fileURLToPath explicitly: this suite runs under happy-dom, whose global `URL`
// resolves relative references differently and mangles the fixture path.
import { fileURLToPath, URL as NodeURL } from "node:url";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractBlockText } from "../features/annotation/containerText";
import { createFakeRenderedAnnotator } from "../features/annotation/renderedAnnotator.fake";
import { ReviewSurfaceView } from "./ReviewSurfaceView";

const CANONICAL_PATH = "deliverables/board-memo.docx";
const HEAD_SHA = "head-67";
const CONTEXT_WINDOW = 32;

// The single physical source of truth for a rendered Canonical head (#67, item 3): the same
// fixture files the server's canonical-html.spec.ts pins REAL mammoth output against. Loading
// them here (fs works in Vitest and Jest) - rather than hand-copying the HTML - makes the
// criterion-1 and embedded-style-map cases genuinely two-sided: a mammoth change breaks the
// server pin and forces a fixture refresh that this suite then consumes.
// Captured at module scope: Vite's transform resolves `import.meta.url` reliably here, but
// reading it inside a nested function under happy-dom yields a bad base that mangles the path.
const MODULE_URL = import.meta.url;

function loadHeadFixture(name: string): {
  renderedHead: string;
  reviewText: string;
} {
  const path = fileURLToPath(
    new NodeURL(`../../../../apps/server/test/fixtures/${name}`, MODULE_URL),
  );
  return JSON.parse(readFileSync(path, "utf8")) as {
    renderedHead: string;
    reviewText: string;
  };
}

// The criterion-1 pair: the EXACT mammoth HTML the server produces from the rich Canonical
// counter-fixture (`buildRichCanonicalDocx()`) and its normalized review-text, loaded from
// the shared fixture. The mounted mammoth-HTML DOM must extract the same visible-text
// sequence the server reproduces. The sentinels are discriminating: a styled heading
// (`<h1>`), a plain paragraph, a split run (`<strong>`), a preserved run of collapsible
// whitespace, and a two-cell table.
const CANONICAL_FIXTURE = loadHeadFixture("canonical-rendered-head.json");
const CANONICAL_RENDERED_HEAD = CANONICAL_FIXTURE.renderedHead;
const CANONICAL_REVIEW_TEXT = CANONICAL_FIXTURE.reviewText;
const CANONICAL_EXPECTED_NORMALIZED = CANONICAL_REVIEW_TEXT.replace(
  /\s+/g,
  " ",
).trim();

// The embedded-style-map counter-fixture (#67, item 2): mammoth's HTML for a docx whose
// document-EMBEDDED style map tries to map an inline run to a non-default `<fieldset>` block
// tag, and its review-text. Because `convertCanonicalHtml` passes `includeEmbeddedStyleMap:
// false`, mammoth ignores the map: the emitted HTML carries only default-set tags, so the
// trusted UN-sanitized Canonical DOM never mounts an off-allowlist tag and the client
// extraction matches the server review-text.
const EMBEDDED_FIXTURE = loadHeadFixture(
  "canonical-embedded-style-map-head.json",
);

// A clean annotation fixture whose mounted mammoth-HTML block-aware text is exactly this
// review-text, so a fresh selection and a stored comment both address real spans of it.
const ANNO_RENDERED_HEAD =
  "<h1>Scope</h1>" +
  "<p>Intro paragraph about scope.</p>" +
  "<p>The Bandersnatch metric holds firm across revisions.</p>" +
  "<p>Closing note.</p>";
const ANNO_REVIEW_TEXT =
  "Scope\nIntro paragraph about scope.\n" +
  "The Bandersnatch metric holds firm across revisions.\nClosing note.";
const PLANTED = "The Bandersnatch metric holds firm across revisions.";
const SECOND = "Intro paragraph about scope.";

// A repeated-quote Canonical fixture: the same quote appears in two blocks, each with
// distinct in-block context, so quote+context locates its own occurrence in the mounted
// rendered document.
const REPEATED_RENDERED_HEAD =
  "<p>The opening section clearly states Repeated claim as its own central and firmly held point here.</p>" +
  "<p>Much further down the closing section again states Repeated claim to reinforce that same earlier point.</p>";
const REPEATED_REVIEW_TEXT =
  "The opening section clearly states Repeated claim as its own central and firmly held point here.\n" +
  "Much further down the closing section again states Repeated claim to reinforce that same earlier point.";

function baseResponse(): ReviewSurfaceResponse {
  return {
    number: 67,
    title: "Comment on rendered Canonical text",
    description: "Canonical annotation fixture",
    sourceBranchUrl: "https://github.com/acme/doc-review/tree/issue-67",
    githubUrl: "https://github.com/acme/doc-review/pull/67",
    currentRound: {
      number: 1,
      headSha: HEAD_SHA,
      createdAt: "2026-07-15T00:00:00.000Z",
      status: "open",
      comments: [],
    },
    rounds: [
      {
        number: 1,
        headSha: HEAD_SHA,
        createdAt: "2026-07-15T00:00:00.000Z",
        status: "open",
        comments: [],
      },
    ],
    files: [],
  };
}

function canonicalResponse(
  renderedHead: string,
  reviewText: string,
  comments: ReviewComment[],
): ReviewSurfaceResponse {
  const base = baseResponse();
  return {
    ...base,
    files: [
      {
        path: CANONICAL_PATH,
        changeType: "modified",
        payload: { format: "docx", renderedHead, reviewText },
      },
    ],
    currentRound: { ...base.currentRound, comments },
    rounds: [{ ...base.rounds[0], comments }],
  };
}

// A stored rendered-text Canonical comment for the `occurrenceIndex`-th occurrence of
// `quote` in `reviewText`, carrying the real surrounding context so it verifies (or drifts).
function makeCanonicalComment(params: {
  reviewText: string;
  id: string;
  quote: string;
  occurrenceIndex?: number;
  drifted?: boolean;
}): ReviewComment {
  const { reviewText, id, quote } = params;
  let start = reviewText.indexOf(quote);
  for (let index = 0; index < (params.occurrenceIndex ?? 0); index += 1) {
    start = reviewText.indexOf(quote, start + 1);
  }
  const end = start + quote.length;
  return {
    scope: "rendered",
    format: "docx",
    path: CANONICAL_PATH,
    quote,
    prefix: reviewText.slice(Math.max(0, start - CONTEXT_WINDOW), start),
    suffix: reviewText.slice(end, end + CONTEXT_WINDOW),
    start,
    end,
    selectorVersion: 1,
    body: `Feedback on ${id}.`,
    id,
    headSha: HEAD_SHA,
    roundNumber: 1,
    createdAt: "2026-07-15T00:00:00.000Z",
    resolved: false,
    carriedForward: false,
    drifted: params.drifted ?? false,
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
    headSha: HEAD_SHA,
    roundNumber: 1,
    createdAt: "2026-07-15T00:00:00.000Z",
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

// A promise held open under the test's control, so a Canonical feedback submission can
// be kept in flight (#89) while a second submit is attempted.
function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function annotationMarks(root: Element): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>("mark[data-annotation-id]"),
  );
}

function canonicalSurface(container: Element): HTMLElement {
  return requiredElement<HTMLElement>(
    container,
    ".review-file__docx [data-annotation-surface]",
  );
}

describe("ReviewSurfaceView rendered Canonical annotation", () => {
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

  it("extracts the same deterministic rendered-text sequence the server reproduces (criterion 1 pair)", () => {
    const normalize = (value: string): string =>
      value.replace(/\s+/g, " ").trim();

    act(() => {
      root.render(
        <ReviewSurfaceView
          {...canonicalResponse(
            CANONICAL_RENDERED_HEAD,
            CANONICAL_REVIEW_TEXT,
            [],
          )}
          annotatorFactory={createFakeRenderedAnnotator().factory}
        />,
      );
    });

    const visible = extractBlockText(canonicalSurface(container)).text;
    expect(normalize(visible)).toBe(CANONICAL_EXPECTED_NORMALIZED);
    // Discriminating: heading and paragraph joined (not merged), split run contiguous,
    // table cells joined (not merged), and document order preserved.
    expect(normalize(visible)).not.toContain("overview.The Bandersnatch");
    expect(visible).toContain("Second paragraph about canonical scope.");
    expect(normalize(visible)).not.toContain("cell.Beta canonical");
    expect(visible.indexOf("Zephyr")).toBeLessThan(
      visible.indexOf("Bandersnatch"),
    );
    expect(visible.indexOf("Alpha canonical")).toBeLessThan(
      visible.indexOf("Beta canonical"),
    );
  });

  it("mounts only default-set tags and extracts the server review-text when a doc embeds a style map (item 2 parity)", () => {
    const normalize = (value: string): string =>
      value.replace(/\s+/g, " ").trim();

    act(() => {
      root.render(
        <ReviewSurfaceView
          {...canonicalResponse(
            EMBEDDED_FIXTURE.renderedHead,
            EMBEDDED_FIXTURE.reviewText,
            [],
          )}
          annotatorFactory={createFakeRenderedAnnotator().factory}
        />,
      );
    });

    const surface = canonicalSurface(container);
    // The server ignored the embedded style map, so the off-allowlist `<fieldset>` it tried to
    // produce never reaches the trusted, UN-sanitized Canonical DOM the reviewer mounts.
    expect(surface.querySelector("fieldset")).toBeNull();
    expect(surface.querySelector("details, form")).toBeNull();

    // The extracted visible text equals the review-text the server reproduces, with the mapped
    // run's text contiguous with its surrounding inline text.
    const visible = extractBlockText(surface).text;
    expect(normalize(visible)).toBe(normalize(EMBEDDED_FIXTURE.reviewText));
    expect(normalize(visible)).toContain(
      "Alpha inline sentinel Beta boxed sentinel Gamma inline sentinel.",
    );
  });

  it("turns a selection in the rendered Canonical into a highlight and a shared versioned draft card (criterion 2)", () => {
    const annotator = createFakeRenderedAnnotator();
    const submitted: FeedbackAnchor[] = [];

    act(() => {
      root.render(
        <ReviewSurfaceView
          {...canonicalResponse(ANNO_RENDERED_HEAD, ANNO_REVIEW_TEXT, [])}
          annotatorFactory={annotator.factory}
          onSubmitFeedback={(anchor) => {
            submitted.push(anchor);
          }}
        />,
      );
    });

    // The planted sentence is genuinely visible in the rendered Canonical, then selected.
    const surface = canonicalSurface(container);
    expect(surface.textContent).toContain(PLANTED);
    act(() => annotator.selectText(PLANTED));

    // One draft card showing the exact quote, and one real painted highlight.
    const draft = requiredElement<HTMLElement>(
      container,
      "[data-annotation-draft]",
    );
    expect(
      requiredElement<HTMLElement>(draft, ".mirror-comment-card__quote")
        .textContent,
    ).toBe(PLANTED);
    const marks = annotationMarks(container);
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe(PLANTED);

    // Submitting yields the shared rendered-text selector - a versioned quote/context/
    // position anchor, NOT the manual section locator or opaque Recogito state.
    editField(
      requiredElement<HTMLTextAreaElement>(draft, '[name="body"]'),
      "Anchor this Canonical sentence.",
    );
    const start = ANNO_REVIEW_TEXT.indexOf(PLANTED);
    const end = start + PLANTED.length;
    act(() => {
      (draft as HTMLFormElement).dispatchEvent(
        new SubmitEvent("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(submitted).toEqual([
      {
        scope: "rendered",
        format: "docx",
        path: CANONICAL_PATH,
        quote: PLANTED,
        prefix: ANNO_REVIEW_TEXT.slice(
          Math.max(0, start - CONTEXT_WINDOW),
          start,
        ),
        suffix: ANNO_REVIEW_TEXT.slice(end, end + CONTEXT_WINDOW),
        start,
        end,
        selectorVersion: 1,
        body: "Anchor this Canonical sentence.",
      },
    ]);
  });

  it("submits two comments through the rail, then restores them on a genuine remount, each navigating to its own passage (criterion 4)", () => {
    const annotator = createFakeRenderedAnnotator();
    const submitted: FeedbackAnchor[] = [];

    const submitSelection = (sentence: string, body: string): void => {
      act(() => annotator.selectText(sentence));
      const draft = requiredElement<HTMLFormElement>(
        container,
        "[data-annotation-draft]",
      );
      editField(
        requiredElement<HTMLTextAreaElement>(draft, '[name="body"]'),
        body,
      );
      act(() => {
        draft.dispatchEvent(
          new SubmitEvent("submit", { bubbles: true, cancelable: true }),
        );
      });
    };

    act(() => {
      root.render(
        <ReviewSurfaceView
          {...canonicalResponse(ANNO_RENDERED_HEAD, ANNO_REVIEW_TEXT, [])}
          annotatorFactory={annotator.factory}
          onSubmitFeedback={(anchor) => {
            submitted.push(anchor);
          }}
        />,
      );
    });

    // Two distinct sentences submitted through the rail.
    submitSelection(PLANTED, "Anchor the metric sentence.");
    submitSelection(SECOND, "Anchor the intro sentence.");
    expect(submitted).toHaveLength(2);

    // Genuinely tear the component down: React state (draft, active id, adapter) is gone.
    act(() => root.unmount());
    expect(annotator.destroyed).toBe(true);
    container.remove();

    // Reload into a fresh root and container, restoring the two submitted selectors from
    // durable round state alone.
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const saved = [
      savedFromAnchor(submitted[0], "docx-a"),
      savedFromAnchor(submitted[1], "docx-b"),
    ];
    act(() => {
      root.render(
        <ReviewSurfaceView
          {...canonicalResponse(ANNO_RENDERED_HEAD, ANNO_REVIEW_TEXT, saved)}
          annotatorFactory={annotator.factory}
        />,
      );
    });

    // No draft leaked; both saved cards and their painted highlights come back.
    expect(container.querySelector("[data-annotation-draft]")).toBeNull();
    const markA = requiredElement<HTMLElement>(
      container,
      'mark[data-annotation-id="docx-a"]',
    );
    const markB = requiredElement<HTMLElement>(
      container,
      'mark[data-annotation-id="docx-b"]',
    );
    expect(annotationMarks(container)).toHaveLength(2);
    expect(markA.textContent).toBe(PLANTED);
    expect(markB.textContent).toBe(SECOND);
    expect(
      requiredElement<HTMLElement>(
        container,
        '[data-annotation-comment-id="docx-a"] .mirror-comment-card__quote',
      ).textContent,
    ).toBe(PLANTED);

    // Activating either restored card navigates to its own passage.
    act(() =>
      requiredElement<HTMLButtonElement>(
        container,
        '[data-annotation-activate="docx-a"]',
      ).click(),
    );
    act(() =>
      requiredElement<HTMLButtonElement>(
        container,
        '[data-annotation-activate="docx-b"]',
      ).click(),
    );
    expect(annotator.activated).toEqual(["docx-a", "docx-b"]);
  });

  it("paints and activates each same-quote comment at its own occurrence, not a shared one (criterion 4)", () => {
    const annotator = createFakeRenderedAnnotator();
    const opening = makeCanonicalComment({
      reviewText: REPEATED_REVIEW_TEXT,
      id: "occ-open",
      quote: "Repeated claim",
      occurrenceIndex: 0,
    });
    const closing = makeCanonicalComment({
      reviewText: REPEATED_REVIEW_TEXT,
      id: "occ-close",
      quote: "Repeated claim",
      occurrenceIndex: 1,
    });

    act(() => {
      root.render(
        <ReviewSurfaceView
          {...canonicalResponse(REPEATED_RENDERED_HEAD, REPEATED_REVIEW_TEXT, [
            opening,
            closing,
          ])}
          annotatorFactory={annotator.factory}
        />,
      );
    });

    const markOpen = requiredElement<HTMLElement>(
      container,
      'mark[data-annotation-id="occ-open"]',
    );
    const markClose = requiredElement<HTMLElement>(
      container,
      'mark[data-annotation-id="occ-close"]',
    );
    expect(annotationMarks(container)).toHaveLength(2);
    expect(markOpen.textContent).toBe("Repeated claim");
    expect(markClose.textContent).toBe("Repeated claim");
    expect(markOpen.closest("p")?.textContent).toContain("opening section");
    expect(markClose.closest("p")?.textContent).toContain("closing section");

    act(() =>
      requiredElement<HTMLButtonElement>(
        container,
        '[data-annotation-activate="occ-open"]',
      ).click(),
    );
    act(() =>
      requiredElement<HTMLButtonElement>(
        container,
        '[data-annotation-activate="occ-close"]',
      ).click(),
    );
    expect(annotator.activated).toEqual(["occ-open", "occ-close"]);
  });

  it("keeps an unverified Canonical selector's quote in the rail but paints no highlight at its stored position (criterion 6)", () => {
    const annotator = createFakeRenderedAnnotator();
    const verified = makeCanonicalComment({
      reviewText: ANNO_REVIEW_TEXT,
      id: "verified-1",
      quote: PLANTED,
    });
    const drifted = makeCanonicalComment({
      reviewText: ANNO_REVIEW_TEXT,
      id: "drifted-1",
      quote: SECOND,
      drifted: true,
    });

    act(() => {
      root.render(
        <ReviewSurfaceView
          {...canonicalResponse(ANNO_RENDERED_HEAD, ANNO_REVIEW_TEXT, [
            verified,
            drifted,
          ])}
          annotatorFactory={annotator.factory}
        />,
      );
    });

    // Both comments keep their quote in the rail.
    expect(
      requiredElement<HTMLElement>(
        container,
        '[data-annotation-comment-id="verified-1"] .mirror-comment-card__quote',
      ).textContent,
    ).toBe(PLANTED);
    const driftedCard = requiredElement<HTMLElement>(
      container,
      '[data-annotation-comment-id="drifted-1"]',
    );
    expect(
      requiredElement<HTMLElement>(driftedCard, ".mirror-comment-card__quote")
        .textContent,
    ).toBe(SECOND);
    expect(driftedCard.getAttribute("data-annotation-painted")).toBe("false");
    expect(driftedCard.querySelector("[data-annotation-activate]")).toBeNull();

    // Only the verified comment is painted; the unverified position gets no highlight.
    const marks = annotationMarks(container);
    expect(marks).toHaveLength(1);
    expect(marks[0].getAttribute("data-annotation-id")).toBe("verified-1");
    expect(marks[0].textContent).toBe(PLANTED);
  });

  it("locks the Canonical-section form while a submission is in flight, ignoring a second submit (#89)", () => {
    const inFlight = createDeferred<void>();
    let calls = 0;
    const onSubmitFeedback = (): Promise<void> => {
      calls += 1;
      return inFlight.promise;
    };

    act(() => {
      root.render(
        <ReviewSurfaceView
          {...canonicalResponse(ANNO_RENDERED_HEAD, ANNO_REVIEW_TEXT, [])}
          annotatorFactory={createFakeRenderedAnnotator().factory}
          onSubmitFeedback={onSubmitFeedback}
        />,
      );
    });

    const form = requiredElement<HTMLFormElement>(
      container,
      '[data-feedback-scope="canonical"]',
    );
    const button = requiredElement<HTMLButtonElement>(
      form,
      'button[type="submit"]',
    );
    const submit = (): void => {
      act(() => {
        form.dispatchEvent(
          new SubmitEvent("submit", { bubbles: true, cancelable: true }),
        );
      });
    };

    submit();
    expect(calls).toBe(1);
    expect(button.disabled).toBe(true);

    submit();
    expect(calls).toBe(1);
    expect(button.disabled).toBe(true);
  });

  it("keeps the source-oriented section-and-quote locator available beside the annotation surface (criterion 7)", () => {
    const annotator = createFakeRenderedAnnotator();

    act(() => {
      root.render(
        <ReviewSurfaceView
          {...canonicalResponse(ANNO_RENDERED_HEAD, ANNO_REVIEW_TEXT, [
            makeCanonicalComment({
              reviewText: ANNO_REVIEW_TEXT,
              id: "docx-a",
              quote: PLANTED,
            }),
          ])}
          annotatorFactory={annotator.factory}
        />,
      );
    });

    // Annotation is active: the saved comment is painted in the rendered Canonical.
    expect(annotationMarks(canonicalSurface(container))).toHaveLength(1);

    // The existing section-and-quote locator form remains available as the secondary
    // feedback affordance, with its section and nearby-quote fields.
    const locatorForm = requiredElement<HTMLFormElement>(
      container,
      '[data-feedback-scope="canonical"]',
    );
    expect(locatorForm.querySelector('[name="section"]')).not.toBeNull();
    expect(locatorForm.querySelector('[name="locatorQuote"]')).not.toBeNull();
  });
});
