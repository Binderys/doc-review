// @vitest-environment jsdom
//
// This one spec runs on jsdom, not the repo-default happy-dom, ON PURPOSE. DOMPurify
// filters by walking a NodeIterator and calling `removeChild(currentNode)` on a
// disallowed node, then `nextNode()`. Per the DOM spec, removing the iterator's
// reference node runs "removing steps" that reposition it so the walk continues.
// happy-dom@20 does not implement those steps, so after the first removal `nextNode()`
// returns null and the walk aborts, leaving unsafe nodes in place - the sanitizer
// silently under-filters and these security assertions would FAIL. Minimal repro under
// happy-dom (no DOMPurify): walking `<p>1</p><iframe></iframe><img><script></script>`
// and removing the current node before `nextNode()` visits only ["P","IFRAME"] and
// leaves `<script>` behind. jsdom (DOMPurify's documented Node/test pairing) and real
// browsers implement the removing steps, so the sanitizer filters correctly here.
// Do not "simplify" this back to happy-dom; keep every other test file on happy-dom.
//
// Scope note: the network/side-effect assertions below target the ANNOTATION COPY (the
// safe surface this slice adds). The raw comparison remains a separate exact-head
// response; its server-owned CSP and browser request behavior have their own seam tests.

import type {
  FeedbackAnchor,
  ReviewComment,
  ReviewSurfaceResponse,
} from "@doc-review/api-contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractBlockText } from "../features/annotation/containerText";
import { createFakeRenderedAnnotator } from "../features/annotation/renderedAnnotator.fake";
import { SanitizedHtmlSurface } from "../features/annotation/SanitizedHtmlSurface";
import { ReviewSurfaceView } from "./ReviewSurfaceView";

// The unique safe sentence that must survive into the annotation copy, in order.
const SAFE_SENTENCE =
  "The Zangwill invariant holds across every revision reviewed.";
const COMPARISON_URL =
  "/pr/acme/board-review/65/raw?path=sources%2Freport.html&ref=6565656565656565656565656565656565656565";
const RESOLVED_COMPARISON_URL = `http://localhost:3000${COMPARISON_URL}`;

// The unique inner sentence of the disclosure widget: its element wrapper must be gone
// while this text survives, unwrapped, in document order.
const DISCLOSURE_SENTENCE = "Disclosure body remains readable text.";

// One authored HTML document carrying the safe sentence plus every unsafe construct the
// annotation copy must exclude or neutralize: a script, an inline event handler, form
// controls, a native details/summary disclosure widget, a nested iframe, object/embed
// content, an external image and link URL, a style element, and a style attribute.
// `window.__htmlXssFired` is the planted side effect a script or handler would trip if
// any of them executed.
const UNSAFE_RAW = [
  "<style>.secret { color: red }</style>",
  '<h2 style="color: red">Section heading</h2>',
  `<p>${SAFE_SENTENCE}</p>`,
  "<script>window.__htmlXssFired = true;</script>",
  '<p onclick="window.__htmlXssFired = true">Notice paragraph.</p>',
  "<form>",
  '<input name="q" value="secret">',
  "<button>Submit</button>",
  "<select><option>Choice</option></select>",
  "<textarea>Draft</textarea>",
  "</form>",
  `<details><summary>Disclosure summary control.</summary><p>${DISCLOSURE_SENTENCE}</p></details>`,
  '<iframe src="https://tracker.example/frame.html"></iframe>',
  '<object data="https://tracker.example/object.swf"></object>',
  '<embed src="https://tracker.example/embed.swf">',
  '<img src="https://tracker.example/pixel.png" alt="Tracking pixel">',
  '<a href="https://tracker.example/out">External link label</a>',
].join("");

function htmlResponse(raw: string): ReviewSurfaceResponse {
  return {
    number: 65,
    title: "Sanitize the HTML annotation copy",
    description: "HTML security fixture",
    sourceBranchUrl: "https://github.com/acme/doc-review/tree/issue-65",
    githubUrl: "https://github.com/acme/doc-review/pull/65",
    currentRound: {
      number: 1,
      headSha: "head-65",
      createdAt: "2026-07-16T00:00:00.000Z",
      status: "open",
      comments: [],
    },
    rounds: [
      {
        number: 1,
        headSha: "head-65",
        createdAt: "2026-07-16T00:00:00.000Z",
        status: "open",
        comments: [],
      },
    ],
    files: [
      {
        path: "sources/report.html",
        changeType: "modified",
        payload: {
          format: "html",
          raw,
          comparisonUrl: COMPARISON_URL,
          reviewText: "",
          sourceDiff: [
            {
              oldLine: 1,
              newLine: 1,
              text: "<p>Report line</p>",
              change: "context",
            },
          ],
        },
      },
    ],
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

function safeCopy(container: Element): HTMLElement {
  return requiredElement<HTMLElement>(container, "[data-html-safe-copy]");
}

// The sanitized copy is now the annotation surface, so mounting it mounts the annotation
// engine. These sanitizer-focused cases inject the in-memory fake adapter (the same
// pattern the annotation cases use) so no Recogito chunk loads - the sanitize/security
// behavior under test is unchanged, and the suite stays deterministic.
const stubAnnotatorFactory = createFakeRenderedAnnotator().factory;

describe("ReviewSurfaceView sanitized HTML annotation copy", () => {
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
    delete (window as unknown as Record<string, unknown>).__htmlXssFired;
    vi.restoreAllMocks();
  });

  it("keeps the safe sentence in order while excluding every unsafe construct from the annotation copy", () => {
    act(() => {
      root.render(
        <ReviewSurfaceView
          {...htmlResponse(UNSAFE_RAW)}
          annotatorFactory={stubAnnotatorFactory}
        />,
      );
    });

    const copy = safeCopy(container);

    // In a real DOM the copy was produced successfully, marked ready - distinct from the
    // server-side unavailable state.
    expect(copy.getAttribute("data-state")).toBe("ready");

    // The unique safe sentence survives, and in its authored document position (after
    // the section heading whose style attribute was stripped but whose text was kept).
    const text = copy.textContent ?? "";
    expect(text).toContain(SAFE_SENTENCE);
    expect(text.indexOf("Section heading")).toBeLessThan(
      text.indexOf(SAFE_SENTENCE),
    );

    // The disclosure widget's element wrapper is gone, but its inner text is unwrapped
    // and kept in document order (after the safe sentence, before the external link).
    expect(text).toContain(DISCLOSURE_SENTENCE);
    expect(text.indexOf(SAFE_SENTENCE)).toBeLessThan(
      text.indexOf(DISCLOSURE_SENTENCE),
    );
    expect(text.indexOf(DISCLOSURE_SENTENCE)).toBeLessThan(
      text.indexOf("External link label"),
    );

    // The script and style BODIES are dropped entirely, not merely unwrapped into inert
    // text: their subtrees leave no visible trace in the copy. Element-null checks alone
    // would pass even if these leaked in as text.
    expect(text).not.toContain("window.__htmlXssFired = true;");
    expect(text).not.toContain(".secret { color: red }");

    // Every unsafe element is absent from the annotation copy.
    for (const tag of [
      "script",
      "style",
      "iframe",
      "object",
      "embed",
      "form",
      "input",
      "button",
      "select",
      "textarea",
      "details",
      "summary",
    ]) {
      expect(
        copy.querySelector(tag),
        `${tag} must not survive into the annotation copy`,
      ).toBeNull();
    }

    // No event-handler, style, or external-URL attribute reaches the copy: every
    // surviving element is inert and loads nothing.
    for (const element of copy.querySelectorAll("*")) {
      for (const attr of element.getAttributeNames()) {
        expect(attr.startsWith("on")).toBe(false);
        expect(["style", "src", "srcset", "href"]).not.toContain(attr);
      }
    }
  });

  it("triggers no external network request and no script or event-handler side effect", async () => {
    (window as unknown as Record<string, unknown>).__htmlXssFired = false;
    const fetchSpy = vi
      .spyOn(window, "fetch")
      .mockRejectedValue(new Error("no external fetch is allowed"));
    const xhrOpen = vi
      .spyOn(XMLHttpRequest.prototype, "open")
      .mockImplementation(() => {
        throw new Error("no external XHR is allowed");
      });

    act(() => {
      root.render(
        <ReviewSurfaceView
          {...htmlResponse(UNSAFE_RAW)}
          annotatorFactory={stubAnnotatorFactory}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    const copy = safeCopy(container);

    // No planted script or inline handler ran.
    expect((window as unknown as Record<string, unknown>).__htmlXssFired).toBe(
      false,
    );
    // No application-level network was issued while producing the copy.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrOpen).not.toHaveBeenCalled();
    // Nothing in the copy could issue a request in a real browser: no resource-loading
    // element, and no error/load handler that a stripped resource would trip.
    expect(
      copy.querySelector("img[src], [srcset], iframe, object, embed"),
    ).toBeNull();
    expect(copy.querySelector("[onerror], [onload]")).toBeNull();
  });

  it("loads the authored comparison through its protected route in a non-interactive sandbox beside a separate same-DOM copy", () => {
    act(() => {
      root.render(
        <ReviewSurfaceView
          {...htmlResponse(UNSAFE_RAW)}
          annotatorFactory={stubAnnotatorFactory}
        />,
      );
    });

    const iframe = requiredElement<HTMLIFrameElement>(
      container,
      "iframe.review-file__html-rendered",
    );
    // The protected exact-head route owns resource loading restrictions. The empty
    // sandbox retains script/origin/form/popup/automatic-navigation restrictions, while
    // inert prevents a reviewer action from activating authored links.
    expect(iframe.getAttribute("sandbox")).toBe("");
    expect(iframe.getAttribute("sandbox")).not.toContain("allow-scripts");
    expect(iframe.getAttribute("src")).toBe(RESOLVED_COMPARISON_URL);
    expect(iframe.hasAttribute("srcdoc")).toBe(false);
    expect(iframe.hasAttribute("inert")).toBe(true);
    expect(iframe.hasAttribute("tabindex")).toBe(false);

    // The sanitized copy is a separate surface in the application DOM, not inside the
    // sandboxed iframe.
    const copy = safeCopy(container);
    expect(iframe.contains(copy)).toBe(false);
    expect(container.contains(copy)).toBe(true);
  });

  it("omits the authored comparison for deleted HTML with no exact head", () => {
    const response = htmlResponse("");
    const file = response.files[0];
    if (!file || file.payload.format !== "html") {
      throw new Error("Expected the HTML fixture");
    }
    response.files = [
      {
        ...file,
        changeType: "deleted",
        payload: { ...file.payload, comparisonUrl: null },
      },
    ];

    act(() => {
      root.render(
        <ReviewSurfaceView
          {...response}
          annotatorFactory={stubAnnotatorFactory}
        />,
      );
    });

    expect(
      container.querySelector("iframe.review-file__html-rendered"),
    ).toBeNull();
    expect(
      container.querySelector(".review-file__source-details"),
    ).not.toBeNull();
  });

  it("exposes deterministic visible text in document order across differing block boundaries and whitespace", () => {
    const normalize = (value: string): string =>
      value.replace(/\s+/g, " ").trim();
    const expected = "First point. Second point. Third point.";

    const blockFixture =
      "<p>First point.</p><p>Second point.</p><p>Third point.</p>";
    const looseFixture =
      "<div>First point.</div>\n\n   <section>  Second point.  </section>" +
      '<h3 style="margin:0">Third point.</h3>';

    for (const raw of [blockFixture, looseFixture]) {
      act(() => {
        root.render(
          <ReviewSurfaceView
            {...htmlResponse(raw)}
            annotatorFactory={stubAnnotatorFactory}
          />,
        );
      });
      const visible = extractBlockText(safeCopy(container)).text;
      expect(normalize(visible)).toBe(expected);
      // Document order is preserved, not merely presence.
      expect(visible.indexOf("First")).toBeLessThan(visible.indexOf("Second"));
      expect(visible.indexOf("Second")).toBeLessThan(visible.indexOf("Third"));
      act(() => root.unmount());
      root = createRoot(container);
    }
  });

  it("marks an empty-input copy ready with empty content, distinct from the unavailable state", () => {
    // Same empty input the SSR sibling test renders (which yields data-state
    // "unavailable"): in a real DOM DOMPurify runs and yields a genuinely-empty but
    // READY copy, so empty-ready and unavailable are structurally distinguishable.
    act(() => {
      root.render(
        <SanitizedHtmlSurface raw="" annotatorFactory={stubAnnotatorFactory} />,
      );
    });
    const copy = safeCopy(container);
    expect(copy.getAttribute("data-state")).toBe("ready");
    expect(copy.textContent).toBe("");
  });

  it("keeps the source diff and source-line feedback controls available beside both rendered surfaces", () => {
    act(() => {
      root.render(
        <ReviewSurfaceView
          {...htmlResponse(UNSAFE_RAW)}
          annotatorFactory={stubAnnotatorFactory}
        />,
      );
    });

    // Both rendered surfaces coexist.
    expect(container.querySelector("[data-html-safe-copy]")).not.toBeNull();
    expect(
      container.querySelector("iframe.review-file__html-rendered"),
    ).not.toBeNull();

    // The source diff and its line-anchor control remain.
    expect(container.querySelector(".review-file__source-diff")).not.toBeNull();
    expect(container.querySelector('[data-anchor-line="1"]')).not.toBeNull();

    // The HTML source-line feedback form remains, with its line and quote fields.
    const form = requiredElement<HTMLFormElement>(
      container,
      '[data-feedback-scope="line"]',
    );
    expect(form.querySelector('[name="line"]')).not.toBeNull();
    expect(form.querySelector('[name="quote"]')).not.toBeNull();
  });
});

// The rendered HTML annotation lifecycle (#66): the sanitized copy joins the SAME
// production annotation adapter and durable feedback lifecycle as the Mirror. Every case
// injects the in-memory fake adapter (so no Recogito chunk loads) and drives selection,
// submission, remount, and navigation as real DOM interactions in the sanitized copy.

// The paired counter-fixture (criterion 1): identical RAW and EXPECTED normalized
// sequence to the server case in apps/server/src/modules/review/review.controller.spec.ts.
const PAIRED_RAW =
  "<style>.secret{color:red}STYLE_BODY_SENTINEL</style>" +
  '<h2 style="color:red">Zephyr overview section.</h2>' +
  "<p>The Bandersnatch metric holds firm across revisions.</p>" +
  "<script>window.__x = 'SCRIPT_BODY_SENTINEL';</script>" +
  '<p onclick="window.__x=1">Second   paragraph   about scope.</p>' +
  "<details><summary>Disclosure summary control.</summary>" +
  "<p>Disclosure body stays readable.</p></details>" +
  '<img src="https://tracker.example/pixel.png" alt="Gamma pixel caption.">' +
  '<p><a href="https://tracker.example/out">External link label.</a></p>';
const PAIRED_EXPECTED =
  "Zephyr overview section. " +
  "The Bandersnatch metric holds firm across revisions. " +
  "Second paragraph about scope. " +
  "Disclosure summary control. " +
  "Disclosure body stays readable. " +
  "Gamma pixel caption. " +
  "External link label.";

// A clean annotation fixture whose sanitized copy's block-aware text is exactly this
// review-text (the server reproduces the same string), so a fresh selection and a stored
// comment both address real spans of it.
const ANNO_RAW =
  "<h2>Scope</h2>" +
  "<p>Intro paragraph about scope.</p>" +
  "<p>The Bandersnatch metric holds firm across revisions.</p>" +
  "<p>Closing note.</p>";
const ANNO_REVIEW_TEXT =
  "Scope\nIntro paragraph about scope.\n" +
  "The Bandersnatch metric holds firm across revisions.\nClosing note.";
const PLANTED = "The Bandersnatch metric holds firm across revisions.";
const SECOND = "Intro paragraph about scope.";
const CONTEXT_WINDOW = 32;

// A repeated-quote HTML fixture: the same quote appears in two blocks, each with distinct
// in-block context, so quote+context locates its own occurrence in the sanitized copy.
const REPEATED_RAW =
  "<p>The opening section clearly states Repeated claim as its own central and firmly held point here.</p>" +
  "<p>Much further down the closing section again states Repeated claim to reinforce that same earlier point.</p>";
const REPEATED_REVIEW_TEXT =
  "The opening section clearly states Repeated claim as its own central and firmly held point here.\n" +
  "Much further down the closing section again states Repeated claim to reinforce that same earlier point.";

// Wraps a submitted rendered anchor with the server-owned keys, as durable round state
// would after a reload - so a remount restores the real submitted selector.
function savedFromAnchor(anchor: FeedbackAnchor, id: string): ReviewComment {
  if (anchor.scope !== "rendered") {
    throw new Error("expected a rendered anchor");
  }
  return {
    ...anchor,
    id,
    headSha: "head-65",
    roundNumber: 1,
    createdAt: "2026-07-16T00:00:00.000Z",
    resolved: false,
    carriedForward: false,
    drifted: false,
  };
}

function htmlAnnotationResponse(
  raw: string,
  reviewText: string,
  comments: ReviewComment[],
): ReviewSurfaceResponse {
  const base = htmlResponse(raw);
  const file = base.files[0];
  // Narrow the discriminated payload so overriding reviewText stays type-checked (the
  // html arm) rather than cast away the union.
  const payload =
    file.payload.format === "html"
      ? { ...file.payload, reviewText }
      : file.payload;
  return {
    ...base,
    files: [{ ...file, payload }],
    currentRound: { ...base.currentRound, comments },
    rounds: [{ ...base.rounds[0], comments }],
  };
}

function makeHtmlComment(
  id: string,
  quote: string,
  opts?: { reviewText?: string; occurrenceIndex?: number },
): ReviewComment {
  const reviewText = opts?.reviewText ?? ANNO_REVIEW_TEXT;
  let start = reviewText.indexOf(quote);
  for (let index = 0; index < (opts?.occurrenceIndex ?? 0); index += 1) {
    start = reviewText.indexOf(quote, start + 1);
  }
  const end = start + quote.length;
  return {
    scope: "rendered",
    format: "html",
    path: "sources/report.html",
    quote,
    prefix: reviewText.slice(Math.max(0, start - CONTEXT_WINDOW), start),
    suffix: reviewText.slice(end, end + CONTEXT_WINDOW),
    start,
    end,
    selectorVersion: 1,
    body: `Feedback on ${id}.`,
    id,
    headSha: "head-65",
    roundNumber: 1,
    createdAt: "2026-07-16T00:00:00.000Z",
    resolved: false,
    carriedForward: false,
    drifted: false,
  };
}

function editField(field: HTMLTextAreaElement, value: string): void {
  Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

// A promise held open under the test's control, so an HTML feedback submission can be
// kept in flight (#89) while a second submit is attempted.
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

describe("ReviewSurfaceView rendered HTML annotation", () => {
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
    vi.restoreAllMocks();
  });

  it("extracts the same deterministic safe-text sequence the server reproduces (criterion 1 pair)", () => {
    const normalize = (value: string): string =>
      value.replace(/\s+/g, " ").trim();

    act(() => {
      root.render(
        <ReviewSurfaceView
          {...htmlAnnotationResponse(PAIRED_RAW, "", [])}
          annotatorFactory={createFakeRenderedAnnotator().factory}
        />,
      );
    });

    const visible = extractBlockText(safeCopy(container)).text;
    expect(normalize(visible)).toBe(PAIRED_EXPECTED);
    // Discriminating sentinels: dropped script/style bodies, joined blocks, kept alt.
    expect(visible).not.toContain("SCRIPT_BODY_SENTINEL");
    expect(visible).not.toContain("STYLE_BODY_SENTINEL");
    expect(visible).toContain("Gamma pixel caption.");
    expect(normalize(visible)).not.toContain("section.The Bandersnatch");
  });

  it("keeps a quoted-attribute angle bracket in the alt text, matching the server (parity)", () => {
    const normalize = (value: string): string =>
      value.replace(/\s+/g, " ").trim();
    // The browser parses the quoted alt correctly, so a `>` inside it stays in the alt
    // text and no markup tail leaks - the same result the server tokenizer produces
    // quote-aware. (Server pair: html-review-text.spec.ts.)
    act(() => {
      root.render(
        <ReviewSurfaceView
          {...htmlAnnotationResponse(
            '<p>Before.<img alt="A > B">After.</p>',
            "",
            [],
          )}
          annotatorFactory={createFakeRenderedAnnotator().factory}
        />,
      );
    });

    const visible = extractBlockText(safeCopy(container)).text;
    expect(normalize(visible)).toBe("Before.A > BAfter.");
    expect(visible).not.toContain('"');
  });

  it("turns a selection in the sanitized copy into a highlight and a shared versioned draft card (criterion 2)", () => {
    const annotator = createFakeRenderedAnnotator();
    const submitted: FeedbackAnchor[] = [];

    act(() => {
      root.render(
        <ReviewSurfaceView
          {...htmlAnnotationResponse(ANNO_RAW, ANNO_REVIEW_TEXT, [])}
          annotatorFactory={annotator.factory}
          onSubmitFeedback={(anchor) => {
            submitted.push(anchor);
          }}
        />,
      );
    });

    // The planted sentence is genuinely visible in the sanitized copy, then selected.
    const surface = safeCopy(container);
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
    // position anchor, NOT raw source-line coordinates or opaque Recogito state.
    editField(
      requiredElement<HTMLTextAreaElement>(draft, '[name="body"]'),
      "Anchor this HTML sentence.",
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
        format: "html",
        path: "sources/report.html",
        quote: PLANTED,
        prefix: ANNO_REVIEW_TEXT.slice(
          Math.max(0, start - CONTEXT_WINDOW),
          start,
        ),
        suffix: ANNO_REVIEW_TEXT.slice(end, end + CONTEXT_WINDOW),
        start,
        end,
        selectorVersion: 1,
        body: "Anchor this HTML sentence.",
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
          {...htmlAnnotationResponse(ANNO_RAW, ANNO_REVIEW_TEXT, [])}
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
      savedFromAnchor(submitted[0], "html-a"),
      savedFromAnchor(submitted[1], "html-b"),
    ];
    act(() => {
      root.render(
        <ReviewSurfaceView
          {...htmlAnnotationResponse(ANNO_RAW, ANNO_REVIEW_TEXT, saved)}
          annotatorFactory={annotator.factory}
        />,
      );
    });

    // No draft leaked; both saved cards and their painted highlights come back.
    expect(container.querySelector("[data-annotation-draft]")).toBeNull();
    const markA = requiredElement<HTMLElement>(
      container,
      'mark[data-annotation-id="html-a"]',
    );
    const markB = requiredElement<HTMLElement>(
      container,
      'mark[data-annotation-id="html-b"]',
    );
    expect(annotationMarks(container)).toHaveLength(2);
    expect(markA.textContent).toBe(PLANTED);
    expect(markB.textContent).toBe(SECOND);
    expect(
      requiredElement<HTMLElement>(
        container,
        '[data-annotation-comment-id="html-a"] .mirror-comment-card__quote',
      ).textContent,
    ).toBe(PLANTED);

    // Activating either restored card navigates to its own passage.
    act(() =>
      requiredElement<HTMLButtonElement>(
        container,
        '[data-annotation-activate="html-a"]',
      ).click(),
    );
    act(() =>
      requiredElement<HTMLButtonElement>(
        container,
        '[data-annotation-activate="html-b"]',
      ).click(),
    );
    expect(annotator.activated).toEqual(["html-a", "html-b"]);
  });

  it("paints and activates each same-quote comment at its own occurrence, not a shared one (criterion 4)", () => {
    const annotator = createFakeRenderedAnnotator();
    const opening = makeHtmlComment("occ-open", "Repeated claim", {
      reviewText: REPEATED_REVIEW_TEXT,
      occurrenceIndex: 0,
    });
    const closing = makeHtmlComment("occ-close", "Repeated claim", {
      reviewText: REPEATED_REVIEW_TEXT,
      occurrenceIndex: 1,
    });

    act(() => {
      root.render(
        <ReviewSurfaceView
          {...htmlAnnotationResponse(REPEATED_RAW, REPEATED_REVIEW_TEXT, [
            opening,
            closing,
          ])}
          annotatorFactory={annotator.factory}
        />,
      );
    });

    // Two highlights, each wrapping the SAME quote but at its OWN occurrence (block).
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

    // Activating each card selects its own highlight - identity is not shared.
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

  it("keeps the scriptless sandbox and HTML source-line feedback usable while annotation is active (criterion 6)", () => {
    const annotator = createFakeRenderedAnnotator();

    act(() => {
      root.render(
        <ReviewSurfaceView
          {...htmlAnnotationResponse(ANNO_RAW, ANNO_REVIEW_TEXT, [
            makeHtmlComment("html-a", PLANTED),
          ])}
          annotatorFactory={annotator.factory}
        />,
      );
    });

    // Annotation is active: the saved comment is painted in the safe copy.
    expect(annotationMarks(safeCopy(container))).toHaveLength(1);

    // The protected exact-head comparison remains in its scriptless, inert sandbox.
    const iframe = requiredElement<HTMLIFrameElement>(
      container,
      "iframe.review-file__html-rendered",
    );
    expect(iframe.getAttribute("sandbox")).toBe("");
    expect(iframe.getAttribute("src")).toBe(RESOLVED_COMPARISON_URL);
    expect(iframe.hasAttribute("inert")).toBe(true);

    // The HTML source-line feedback form and the source diff remain available.
    const lineForm = requiredElement<HTMLFormElement>(
      container,
      '[data-feedback-scope="line"]',
    );
    expect(lineForm.querySelector('[name="line"]')).not.toBeNull();
    expect(lineForm.querySelector('[name="quote"]')).not.toBeNull();
    expect(container.querySelector(".review-file__source-diff")).not.toBeNull();
  });

  it("locks the HTML source-line form while a submission is in flight, ignoring a second submit (#89)", () => {
    const inFlight = createDeferred<void>();
    let calls = 0;
    const onSubmitFeedback = (): Promise<void> => {
      calls += 1;
      return inFlight.promise;
    };

    act(() => {
      root.render(
        <ReviewSurfaceView
          {...htmlAnnotationResponse(ANNO_RAW, ANNO_REVIEW_TEXT, [])}
          annotatorFactory={createFakeRenderedAnnotator().factory}
          onSubmitFeedback={onSubmitFeedback}
        />,
      );
    });

    const form = requiredElement<HTMLFormElement>(
      container,
      '[data-feedback-scope="line"]',
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

  it("issues no external content or comment request across selection, submission, and navigation (criterion 7)", () => {
    const fetchSpy = vi
      .spyOn(window, "fetch")
      .mockRejectedValue(new Error("no external fetch is allowed"));
    const xhrOpen = vi
      .spyOn(XMLHttpRequest.prototype, "open")
      .mockImplementation(() => {
        throw new Error("no external XHR is allowed");
      });
    const annotator = createFakeRenderedAnnotator();
    const submitted: FeedbackAnchor[] = [];

    act(() => {
      root.render(
        <ReviewSurfaceView
          {...htmlAnnotationResponse(ANNO_RAW, ANNO_REVIEW_TEXT, [
            makeHtmlComment("html-a", SECOND),
          ])}
          annotatorFactory={annotator.factory}
          onSubmitFeedback={(anchor) => {
            submitted.push(anchor);
          }}
        />,
      );
    });

    // Drive the full local interaction: select, submit, and activate a saved passage.
    act(() => annotator.selectText(PLANTED));
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
        '[data-annotation-activate="html-a"]',
      ).click(),
    );

    // The interactions stayed entirely local: the submit went to the injected callback,
    // and no external content or comment request escaped to the configured origins.
    expect(submitted).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrOpen).not.toHaveBeenCalled();
  });
});
