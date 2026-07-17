// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import type { RenderedAnnotator } from "./renderedAnnotator";
import { createFakeRenderedAnnotator } from "./renderedAnnotator.fake";
import {
  createRecogitoRenderedAnnotator,
  toRawSelection,
  toTextAnnotation,
} from "./recogitoRenderedAnnotator";

// The doc-review-owned adapter boundary (spec #56, AC6): browser selection, highlights,
// active state, and navigation cross it, and only plain doc-review shapes do - never an
// opaque Recogito (W3C) object. The reference fake proves the boundary behavior; the
// real Recogito adapter is checked for interface conformance and translation purity.

function hasAnnotatorInterface(annotator: RenderedAnnotator): boolean {
  return (
    typeof annotator.setHighlights === "function" &&
    typeof annotator.activateHighlight === "function" &&
    typeof annotator.destroy === "function"
  );
}

describe("RenderedAnnotator boundary (reference fake)", () => {
  it("delivers a plain selection across the seam and paints the doc-review highlight set", () => {
    const controller = createFakeRenderedAnnotator();
    const seen: (ReturnType<typeof Object.keys> | null)[] = [];
    const container = document.createElement("div");
    container.textContent = "before Anchored sentence. after";
    const annotator = controller.factory({
      container,
      handlers: {
        onSelect: (selection) =>
          seen.push(selection ? Object.keys(selection) : null),
        onActivate: () => {},
      },
    });
    expect(hasAnnotatorInterface(annotator)).toBe(true);

    controller.selectText("Anchored sentence.");
    controller.clearSelection();
    // The reviewer's selection reaches doc-review as a plain object derived from the
    // container's own text, not a Recogito target.
    expect(seen).toEqual([["quote", "prefix", "suffix"], null]);

    annotator.setHighlights([
      {
        id: "c1",
        quote: "Anchored sentence.",
        prefix: "before ",
        suffix: " after",
      },
    ]);
    expect(controller.lastHighlights()).toEqual([
      {
        id: "c1",
        quote: "Anchored sentence.",
        prefix: "before ",
        suffix: " after",
      },
    ]);
    // The fake painted a real DOM highlight wrapping that exact passage.
    const mark = container.querySelector('mark[data-annotation-id="c1"]');
    expect(mark?.textContent).toBe("Anchored sentence.");

    annotator.activateHighlight("c1");
    expect(controller.activated).toEqual(["c1"]);

    annotator.destroy();
    expect(controller.destroyed).toBe(true);
  });

  it("is a safe no-op after destroy (paints nothing, activates nothing)", () => {
    const controller = createFakeRenderedAnnotator();
    const container = document.createElement("div");
    container.innerHTML = "<p>Some visible content here.</p>";
    const annotator = controller.factory({
      container,
      handlers: { onSelect: () => {}, onActivate: () => {} },
    });

    annotator.destroy();
    expect(controller.destroyed).toBe(true);

    const painted = annotator.setHighlights([
      { id: "x", quote: "visible content", prefix: "Some ", suffix: " here." },
    ]);
    expect(painted).toEqual([]);
    expect(container.querySelectorAll("mark[data-annotation-id]")).toHaveLength(
      0,
    );

    annotator.activateHighlight("x");
    expect(controller.activated).toEqual([]);
  });

  it("routes a document-side highlight click back to doc-review as an id", () => {
    const controller = createFakeRenderedAnnotator();
    const activated: string[] = [];
    controller.factory({
      container: document.createElement("div"),
      handlers: {
        onSelect: () => {},
        onActivate: (id) => activated.push(id),
      },
    });
    controller.activateInDocument("c2");
    expect(activated).toEqual(["c2"]);
  });
});

describe("Recogito adapter translation (no opaque object crosses the seam)", () => {
  it("maps a doc-review highlight to a plain Recogito text annotation at its rendered span", () => {
    const annotation = toTextAnnotation(
      {
        id: "c9",
        quote: "Bandersnatch metric",
        prefix: "The ",
        suffix: " holds firm.",
      },
      { start: 10, end: 29 },
    );
    // Plain, JSON-serializable; the span is the rendered-document span, not the
    // review-text offsets the doc-review highlight carried.
    expect(JSON.parse(JSON.stringify(annotation))).toEqual({
      id: "c9",
      bodies: [],
      target: {
        annotation: "c9",
        selector: [{ quote: "Bandersnatch metric", start: 10, end: 29 }],
      },
    });
  });

  it("maps a Recogito selection back to a plain raw selection with block-aware context", () => {
    const container = document.createElement("div");
    container.innerHTML = "<p>The Bandersnatch metric holds firm.</p>";
    const raw = toRawSelection(
      {
        id: "pending",
        bodies: [],
        target: {
          annotation: "pending",
          selector: [{ quote: "Bandersnatch metric", start: 4, end: 23 }],
        },
      },
      container,
    );
    expect(raw).toEqual({
      quote: "Bandersnatch metric",
      prefix: "The ",
      suffix: " holds firm.",
    });

    const empty = toRawSelection(
      {
        id: "pending",
        bodies: [],
        target: {
          annotation: "pending",
          selector: [{ quote: "", start: 0, end: 0 }],
        },
      },
      container,
    );
    expect(empty).toBeNull();
  });
});

describe("Recogito adapter interface conformance", () => {
  it("constructs against a container and exposes the RenderedAnnotator interface", () => {
    const container = document.createElement("div");
    container.textContent = "Exact rendered Mirror sentence.";
    document.body.append(container);

    const annotator = createRecogitoRenderedAnnotator({
      container,
      handlers: { onSelect: () => {}, onActivate: () => {} },
    });

    expect(hasAnnotatorInterface(annotator)).toBe(true);
    expect(() => annotator.destroy()).not.toThrow();
    container.remove();
  });
});
