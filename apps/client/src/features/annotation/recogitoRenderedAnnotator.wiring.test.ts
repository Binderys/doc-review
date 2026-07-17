// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import type { RawRenderedSelection } from "./renderedAnnotator";

// Drives the real Recogito adapter with the @recogito/text-annotator module mocked, so
// its event wiring and highlight/activation calls are exercised and asserted to pass
// only plain doc-review shapes across the seam (issue #64 AC6). Recogito's real browser
// rendering has no layout in this env; that behavior is exercised in a real browser.
const recorded = vi.hoisted(() => ({
  handlers: {} as Record<string, (annotation: unknown) => void>,
  removed: [] as string[],
  setAnnotationsCalls: [] as unknown[],
  replaceFlags: [] as boolean[],
  selected: [] as string[],
  scrolled: [] as string[],
  destroyed: 0,
}));

vi.mock("@recogito/text-annotator", () => ({
  createTextAnnotator: () => ({
    on: (event: string, callback: (annotation: unknown) => void) => {
      recorded.handlers[event] = callback;
    },
    removeAnnotation: (id: string) => recorded.removed.push(id),
    setAnnotations: (annotations: unknown, replace: boolean) => {
      recorded.setAnnotationsCalls.push(annotations);
      recorded.replaceFlags.push(replace);
    },
    setSelected: (id: string) => recorded.selected.push(id),
    scrollIntoView: (id: string) => recorded.scrolled.push(id),
    destroy: () => {
      recorded.destroyed += 1;
    },
  }),
}));

const { createRecogitoRenderedAnnotator } =
  await import("./recogitoRenderedAnnotator");

// The plain annotation shape the adapter passes to Recogito's setAnnotations; typed so
// the round-tripped JSON is narrowed rather than implicit any (no-any rule).
type PaintedAnnotation = {
  id: string;
  bodies: unknown[];
  target: {
    annotation: string;
    selector: { quote: string; start: number; end: number }[];
  };
};

function lastPainted(): PaintedAnnotation[] {
  return JSON.parse(
    JSON.stringify(recorded.setAnnotationsCalls.at(-1) ?? []),
  ) as PaintedAnnotation[];
}

describe("Recogito adapter wiring (mocked text-annotator)", () => {
  it("translates a Recogito selection to a plain doc-review selection with rendered context", () => {
    const container = document.createElement("div");
    container.textContent = "The Bandersnatch metric holds firm.";
    const selections: (RawRenderedSelection | null)[] = [];

    createRecogitoRenderedAnnotator({
      container,
      handlers: {
        onSelect: (selection) => selections.push(selection),
        onActivate: () => {},
      },
    });

    recorded.handlers.createAnnotation({
      id: "pending",
      bodies: [],
      target: {
        annotation: "pending",
        selector: [{ quote: "Bandersnatch metric", start: 4, end: 23 }],
      },
    });

    // The pending Recogito annotation is dropped; doc-review receives only plain shapes.
    expect(recorded.removed).toContain("pending");
    expect(selections).toEqual([
      {
        quote: "Bandersnatch metric",
        prefix: "The ",
        suffix: " holds firm.",
      },
    ]);
  });

  it("routes a clicked highlight back to doc-review as an id", () => {
    const activated: string[] = [];
    createRecogitoRenderedAnnotator({
      container: document.createElement("div"),
      handlers: { onSelect: () => {}, onActivate: (id) => activated.push(id) },
    });

    recorded.handlers.clickAnnotation({
      id: "comment-x",
      bodies: [],
      target: { annotation: "comment-x", selector: [{ quote: "q" }] },
    });
    expect(activated).toEqual(["comment-x"]);
  });

  it("draws each highlight at its located rendered span and replaces the prior set", () => {
    recorded.setAnnotationsCalls.length = 0;
    recorded.replaceFlags.length = 0;
    const container = document.createElement("div");
    container.textContent = "The Bandersnatch metric holds firm.";

    const annotator = createRecogitoRenderedAnnotator({
      container,
      handlers: { onSelect: () => {}, onActivate: () => {} },
    });

    // The highlight is drawn at the span the quote occupies in the rendered document,
    // as a plain annotation, and setHighlights reports it painted.
    const painted = annotator.setHighlights([
      {
        id: "c1",
        quote: "Bandersnatch metric",
        prefix: "The ",
        suffix: " holds firm.",
      },
    ]);
    expect(painted).toEqual(["c1"]);
    expect(lastPainted()).toEqual([
      {
        id: "c1",
        bodies: [],
        target: {
          annotation: "c1",
          selector: [{ quote: "Bandersnatch metric", start: 4, end: 23 }],
        },
      },
    ]);
    expect(recorded.replaceFlags.at(-1)).toBe(true);
  });

  // Divergence class 1 at the adapter: the review-text (against which the comment was
  // verified) retains inline HTML literally, so its quote occurs ONCE; the rendered DOM
  // strips the empty tag, so the container has an extra cross-tag phantom of the same
  // quote. Painting by verified context must never land on the phantom. Occurrence
  // counts genuinely diverge here, so any index-transport approach would mis-paint.
  it("paints the context-matching occurrence, never a cross-tag phantom the DOM adds", () => {
    recorded.setAnnotationsCalls.length = 0;
    // reviewText: "ab" appears once (the plain later one); the earlier "a<span></span>b"
    // is literal and contains no "ab" substring.
    const reviewText =
      "Prologue a<span></span>b marks the opening spot. Many words later the plain ab ends the note cleanly here.";
    const legitReviewStart = reviewText.indexOf(
      "ab",
      reviewText.indexOf("plain"),
    );
    const highlight = {
      id: "c-legit",
      quote: "ab",
      prefix: reviewText.slice(legitReviewStart - 32, legitReviewStart),
      suffix: reviewText.slice(legitReviewStart + 2, legitReviewStart + 2 + 32),
    };

    const container = document.createElement("div");
    // The real rendered DOM: the empty span collapses so "ab" occurs TWICE in the
    // container - the phantom in the first block and the legitimate one in the second.
    container.innerHTML =
      "<p>Prologue a<span></span>b marks the opening spot.</p>" +
      "<p>Many words later the plain ab ends the note cleanly here.</p>";
    const containerText = container.textContent ?? "";
    const phantomStart = containerText.indexOf("ab");
    const legitContainerStart = containerText.indexOf(
      "ab",
      containerText.indexOf("plain"),
    );

    const annotator = createRecogitoRenderedAnnotator({
      container,
      handlers: { onSelect: () => {}, onActivate: () => {} },
    });
    const painted = annotator.setHighlights([highlight]);

    expect(painted).toEqual(["c-legit"]);
    const annotations = lastPainted();
    expect(annotations).toHaveLength(1);
    expect(annotations[0].target.selector[0].start).toBe(legitContainerStart);
    expect(annotations[0].target.selector[0].start).not.toBe(phantomStart);
  });

  it("reports nothing painted when a highlight fails to locate in the rendered document", () => {
    recorded.setAnnotationsCalls.length = 0;
    const container = document.createElement("div");
    container.innerHTML =
      "<p>The rendered document is about other matters.</p>";

    const annotator = createRecogitoRenderedAnnotator({
      container,
      handlers: { onSelect: () => {}, onActivate: () => {} },
    });
    const painted = annotator.setHighlights([
      { id: "absent", quote: "not present here", prefix: "", suffix: "" },
    ]);

    expect(painted).toEqual([]);
    expect(lastPainted()).toEqual([]);
  });

  it("selects and scrolls a highlight into view on activation, and tears down", () => {
    recorded.selected.length = 0;
    recorded.scrolled.length = 0;
    const before = recorded.destroyed;

    const annotator = createRecogitoRenderedAnnotator({
      container: document.createElement("div"),
      handlers: { onSelect: () => {}, onActivate: () => {} },
    });

    annotator.activateHighlight("c1");
    expect(recorded.selected).toEqual(["c1"]);
    expect(recorded.scrolled).toEqual(["c1"]);

    annotator.destroy();
    expect(recorded.destroyed).toBe(before + 1);
  });

  it("is a safe no-op after destroy (setHighlights/activateHighlight touch nothing)", () => {
    recorded.setAnnotationsCalls.length = 0;
    recorded.selected.length = 0;
    recorded.scrolled.length = 0;
    const beforeDestroyed = recorded.destroyed;
    const container = document.createElement("div");
    container.innerHTML = "<p>The rendered document has some content.</p>";

    const annotator = createRecogitoRenderedAnnotator({
      container,
      handlers: { onSelect: () => {}, onActivate: () => {} },
    });

    annotator.destroy();
    expect(recorded.destroyed).toBe(beforeDestroyed + 1);

    // A stale paint effect closing over this instance must not touch the torn-down
    // Recogito annotator. (Removing the guard makes setAnnotations run - the mock
    // records it and this fails.)
    const painted = annotator.setHighlights([
      { id: "x", quote: "some content", prefix: "document has ", suffix: "." },
    ]);
    expect(painted).toEqual([]);
    expect(recorded.setAnnotationsCalls).toHaveLength(0);

    annotator.activateHighlight("x");
    expect(recorded.selected).toEqual([]);
    expect(recorded.scrolled).toEqual([]);

    // A second destroy is idempotent.
    annotator.destroy();
    expect(recorded.destroyed).toBe(beforeDestroyed + 1);
  });

  it("ignores Recogito events emitted after destroy (handlers and removeAnnotation untouched)", () => {
    recorded.removed.length = 0;
    const container = document.createElement("div");
    container.innerHTML = "<p>The rendered document has some content.</p>";
    const selections: unknown[] = [];
    const activated: string[] = [];

    const annotator = createRecogitoRenderedAnnotator({
      container,
      handlers: {
        onSelect: (selection) => selections.push(selection),
        onActivate: (id) => activated.push(id),
      },
    });

    annotator.destroy();

    // Recogito emits a selection and a click during/after teardown; both callbacks must
    // no-op - doc-review is not notified and the torn-down annotator is not touched.
    recorded.handlers.createAnnotation({
      id: "pending",
      bodies: [],
      target: {
        annotation: "pending",
        selector: [{ quote: "some content", start: 13, end: 25 }],
      },
    });
    recorded.handlers.clickAnnotation({
      id: "comment-y",
      bodies: [],
      target: { annotation: "comment-y", selector: [{ quote: "q" }] },
    });

    expect(selections).toEqual([]);
    expect(activated).toEqual([]);
    expect(recorded.removed).toEqual([]);
  });
});
