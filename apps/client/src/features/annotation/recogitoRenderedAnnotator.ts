import {
  createTextAnnotator,
  type TextAnnotation,
} from "@recogito/text-annotator";
import "@recogito/text-annotator/text-annotator.css";
import { locateQuoteInContainer, readContainerContext } from "./containerText";
import type {
  RenderedAnnotatorFactory,
  RawRenderedSelection,
  RenderedHighlight,
} from "./renderedAnnotator";
import type { QuoteSpan } from "./renderedTextSelector";

// The reviewer selects in the rendered document (a Mirror or the sanitized HTML copy).
// These functions are the whole translation layer between Recogito's model and doc-review's
// plain shapes; nothing else about Recogito escapes this module (spec #56, AC6). doc-review
// re-locates every quote by quote+context against block-aware rendered text, so a Recogito
// offset is only a hint.

// A doc-review highlight -> the Recogito text annotation that renders it, given the
// raw-textContent span the quote occupies in the rendered document.
export function toTextAnnotation(
  highlight: RenderedHighlight,
  span: QuoteSpan,
): TextAnnotation {
  return {
    id: highlight.id,
    bodies: [],
    target: {
      annotation: highlight.id,
      selector: [{ quote: highlight.quote, start: span.start, end: span.end }],
    },
  };
}

// A Recogito selection/annotation -> the raw doc-review selection: the exact quote plus the
// block-aware rendered-document text around it. No Recogito object crosses the seam.
export function toRawSelection(
  annotation: TextAnnotation,
  container: HTMLElement,
): RawRenderedSelection | null {
  const selector = annotation.target.selector[0];
  if (!selector || selector.quote.length === 0) return null;
  const start = selector.start ?? 0;
  const end = selector.end ?? start + selector.quote.length;
  return {
    quote: selector.quote,
    ...readContainerContext(container, start, end),
  };
}

// The production adapter: Recogito owns browser selection, visible highlights, active
// state, and scroll-to-passage on the rendered Mirror; doc-review drives it only through
// the plain seam.
export const createRecogitoRenderedAnnotator: RenderedAnnotatorFactory = ({
  container,
  handlers,
}) => {
  const annotator = createTextAnnotator<TextAnnotation, TextAnnotation>(
    container,
  );

  // Once destroyed, every entry point - the public methods AND the Recogito event
  // callbacks - is a safe no-op. On a co-change commit React can run this instance's
  // cleanup (destroy) before a still-pending paint effect that closed over it, or
  // Recogito can emit an event during teardown; the guard keeps any of those from
  // touching a torn-down Recogito instance or doc-review's handlers.
  let destroyed = false;

  // A fresh browser selection: report the raw selection to doc-review, then drop
  // Recogito's transient pending annotation. doc-review is the single source of truth for
  // which spans are drawn, so the pending highlight is re-applied via setHighlights.
  annotator.on("createAnnotation", (annotation: TextAnnotation) => {
    if (destroyed) return;
    const raw = toRawSelection(annotation, container);
    annotator.removeAnnotation(annotation.id);
    handlers.onSelect(raw);
  });

  annotator.on("clickAnnotation", (annotation: TextAnnotation) => {
    if (destroyed) return;
    handlers.onActivate(annotation.id);
  });

  return {
    setHighlights(highlights: RenderedHighlight[]): string[] {
      if (destroyed) return [];
      // Each highlight carries its verified quote plus prefix/suffix context; locate
      // that quote+context in the block-aware rendered document. locateQuoteInContainer
      // refuses zero or multiple matches, so a quote the rendered document diverges on,
      // or a repeat the context cannot single out, paints nothing rather than the wrong
      // passage. Return the ids actually painted so doc-review never offers navigation to
      // an undrawn highlight.
      const painted: string[] = [];
      const annotations = highlights.flatMap((highlight) => {
        const span = locateQuoteInContainer(container, highlight);
        if (!span) return [];
        painted.push(highlight.id);
        return [toTextAnnotation(highlight, span)];
      });
      annotator.setAnnotations(annotations, true);
      return painted;
    },
    activateHighlight(id: string) {
      if (destroyed) return;
      annotator.setSelected(id);
      annotator.scrollIntoView(id);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      annotator.destroy();
    },
  };
};
