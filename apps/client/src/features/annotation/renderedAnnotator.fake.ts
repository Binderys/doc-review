import { locateQuoteInContainer, readContainerContext } from "./containerText";
import type {
  RenderedAnnotatorFactory,
  RenderedAnnotatorHandlers,
  RenderedHighlight,
} from "./renderedAnnotator";

// A reference in-memory RenderedAnnotator used by the mounted-DOM and adapter-contract
// tests. It stands in for Recogito's real browser rendering (spec #56: test external
// behavior, not Recogito internals), but stays honest about the DOM: it derives a
// simulated selection from the mounted container's ACTUAL text, and paints real
// <mark data-annotation-id> elements by locating each highlight's quote+context in the
// container itself (the same fail-closed match the production adapter uses). So a test's
// "one visible highlight" or verified/drifted no-paint check is a genuine DOM assertion.
// Not imported by the app, so it never ships.

const MARK_SELECTOR = "mark[data-annotation-id]";

export type FakeRenderedAnnotatorController = {
  factory: RenderedAnnotatorFactory;
  // Simulate selecting `text` in the rendered document: the raw selection is derived
  // from the container's own text (throws if the text is not visible there).
  selectText(text: string): void;
  // Simulate clearing the browser selection.
  clearSelection(): void;
  // Simulate the reviewer clicking an already-rendered highlight in the document.
  activateInDocument(id: string): void;
  // The doc-review highlight set the adapter was last told to render.
  lastHighlights(): RenderedHighlight[];
  readonly highlightCalls: RenderedHighlight[][];
  readonly activated: string[];
  readonly mounted: boolean;
  readonly destroyed: boolean;
};

// Wraps the half-open `[start, end)` character range of `container`'s text content in a
// <mark>, splitting the covering text nodes. The fixtures keep each planted sentence
// within one text node, so a match is covered by a single node.
function wrapRange(
  container: HTMLElement,
  start: number,
  end: number,
  id: string,
): void {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const pieces: { node: Text; from: number; to: number }[] = [];
  let offset = 0;
  for (
    let node = walker.nextNode() as Text | null;
    node;
    node = walker.nextNode() as Text | null
  ) {
    const nodeStart = offset;
    const nodeEnd = offset + node.data.length;
    const from = Math.max(start, nodeStart);
    const to = Math.min(end, nodeEnd);
    if (from < to) {
      pieces.push({ node, from: from - nodeStart, to: to - nodeStart });
    }
    offset = nodeEnd;
  }

  for (const piece of pieces) {
    const range = document.createRange();
    range.setStart(piece.node, piece.from);
    range.setEnd(piece.node, piece.to);
    const mark = document.createElement("mark");
    mark.setAttribute("data-annotation-id", id);
    range.surroundContents(mark);
  }
}

// Removes every painted mark, restoring the underlying text, so the next paint starts
// from the original rendered document.
function clearMarks(container: HTMLElement): void {
  for (const mark of Array.from(container.querySelectorAll(MARK_SELECTOR))) {
    mark.replaceWith(document.createTextNode(mark.textContent ?? ""));
  }
  container.normalize();
}

export function createFakeRenderedAnnotator(): FakeRenderedAnnotatorController {
  let mountedContainer: HTMLElement | null = null;
  let handlers: RenderedAnnotatorHandlers | undefined;
  const highlightCalls: RenderedHighlight[][] = [];
  const activated: string[] = [];
  let mounted = false;
  let destroyed = false;

  const factory: RenderedAnnotatorFactory = (options) => {
    const container = options.container;
    mountedContainer = container;
    handlers = options.handlers;
    mounted = true;
    destroyed = false;
    // Per-instance, so a destroyed instance's methods are no-ops even while a newer
    // instance is live (the co-change-commit case).
    let instanceDestroyed = false;
    return {
      setHighlights(highlights): string[] {
        if (instanceDestroyed) return [];
        highlightCalls.push(highlights);
        clearMarks(container);
        const painted: string[] = [];
        for (const highlight of highlights) {
          const span = locateQuoteInContainer(container, highlight);
          if (span) {
            wrapRange(container, span.start, span.end, highlight.id);
            painted.push(highlight.id);
          }
        }
        return painted;
      },
      activateHighlight(id) {
        if (instanceDestroyed) return;
        activated.push(id);
      },
      destroy() {
        instanceDestroyed = true;
        mounted = false;
        destroyed = true;
      },
    };
  };

  return {
    factory,
    selectText: (text) => {
      const containerText = mountedContainer?.textContent ?? "";
      const index = containerText.indexOf(text);
      if (!mountedContainer || index < 0) {
        throw new Error(
          `Fake selection "${text}" is not visible in the rendered container`,
        );
      }
      // Report block-aware context (what the production adapter would extract), so a
      // repeated selection is disambiguated against the review-text the same way.
      handlers?.onSelect({
        quote: text,
        ...readContainerContext(mountedContainer, index, index + text.length),
      });
    },
    clearSelection: () => handlers?.onSelect(null),
    activateInDocument: (id) => handlers?.onActivate(id),
    lastHighlights: () => highlightCalls.at(-1) ?? [],
    highlightCalls,
    activated,
    get mounted() {
      return mounted;
    },
    get destroyed() {
      return destroyed;
    },
  };
}
