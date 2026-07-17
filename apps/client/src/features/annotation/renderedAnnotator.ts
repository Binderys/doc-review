import type { RenderedTextFeedback } from "@doc-review/api-contracts";

// The doc-review-owned adapter boundary for rendered-document annotation, format-general
// across every rendered surface (Mirror #64, sanitized HTML #66). Recogito lives behind
// this seam: browser selection, visible highlights, active-annotation state, and
// scroll-to-passage navigation are its job, and only the plain shapes declared here cross
// the boundary. No Recogito (W3C) object is ever exchanged, so doc-review's durable comment
// state stays contract-shaped (spec #56, AC6).

// What the adapter reports when the reviewer completes a browser selection: the exact
// selected text, and the text it saw immediately before/after the selection in the
// rendered document. doc-review (not the adapter) locates this in the authoritative
// normalized review-text to build the durable selector, using the context to
// disambiguate a repeated quote, so the adapter never owns the contract offsets.
export type RawRenderedSelection = {
  quote: string;
  prefix?: string;
  suffix?: string;
};

// The durable, doc-review-owned selector fields, derived from the wire contract so this
// module composes with the existing rendered-text anchor rather than inventing a shape.
export type RenderedTextSelection = Pick<
  RenderedTextFeedback,
  "quote" | "prefix" | "suffix" | "start" | "end"
>;

// A verified comment the adapter should render as a visible highlight, addressed by a
// doc-review id. It carries the decision-bearing selector - the exact quote plus its
// prefix/suffix context - NOT a position or occurrence index. The rendered document is
// independently derived from the review-text doc-review verified against, so the adapter
// re-locates the quote+context in the rendered document itself; on divergence or
// ambiguity it paints nothing rather than a different repeat of the quote.
export type RenderedHighlight = {
  id: string;
  quote: string;
  prefix: string;
  suffix: string;
};

export type RenderedAnnotatorHandlers = {
  // The reviewer completed (or cleared, with `null`) a browser selection.
  onSelect: (selection: RawRenderedSelection | null) => void;
  // The reviewer activated an already-rendered highlight in the document.
  onActivate: (id: string) => void;
};

export type RenderedAnnotator = {
  // Replace the rendered highlight set. doc-review owns which spans it asks to draw
  // (verified saved comments plus the pending draft); the adapter locates each in the
  // rendered document and returns the ids it actually painted. A highlight whose
  // quote+context does not locate (rendered document diverged, or ambiguous) is not in
  // the returned set, so doc-review never offers navigation to an undrawn highlight.
  setHighlights(highlights: RenderedHighlight[]): string[];
  // Select a highlight and scroll it into view (navigate to the verified passage).
  activateHighlight(id: string): void;
  destroy(): void;
};

export type RenderedAnnotatorFactory = (options: {
  container: HTMLElement;
  handlers: RenderedAnnotatorHandlers;
}) => RenderedAnnotator;
