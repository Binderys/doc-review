// The single source of the rendered-text quote+context matching core (#82): locating exact
// occurrences of a quote in a normalized review-text and deciding whether stored
// prefix/suffix context agrees around a span, with document-boundary semantics for empty
// context. Pure string functions - no DOM, Recogito, persistence, or document-format
// knowledge. The server reattachment module (`rendered-text-reattachment.ts`), the server
// anchor validator (`review.service.ts` `validateAnchor`), and the client paint gate
// (`renderedTextSelector.ts`) all derive their decisions from these functions, so the one
// matching concept is written once. DOM-specific whitespace collapse (client) and the
// reattachment decision table (server) stay with their consumers.

// A half-open span [start, end) into a review-text, in that text's own offsets.
export interface RenderedTextSpan {
  start: number;
  end: number;
}

// The decision-bearing surroundings of a located quote. Empty is a document-boundary claim,
// not a wildcard (see `contextAgreesAt`).
export interface RenderedTextContext {
  prefix: string;
  suffix: string;
}

// Every start index at which `quote` occurs exactly in `text`, overlapping occurrences
// counted (advance by one) so near-repeats can only make a decision more conservative,
// never less. An empty quote fails closed to no occurrences: `String.indexOf("")` clamps to
// the length instead of returning -1, so the advance-by-one loop would never terminate, and
// no valid anchor carries an empty quote (every consumer treats it as invalid upstream).
export function exactOccurrences(text: string, quote: string): number[] {
  if (quote === "") {
    return [];
  }
  const starts: number[] = [];
  for (
    let from = text.indexOf(quote);
    from !== -1;
    from = text.indexOf(quote, from + 1)
  ) {
    starts.push(from);
  }
  return starts;
}

// Whether the stored prefix and suffix both sit immediately around the half-open span in
// `text`, with empty context read as a document-BOUNDARY claim rather than a wildcard: an
// empty prefix asserts the span starts the document, so it agrees only when the span is at
// index 0; an empty suffix asserts the span ends the document, so it agrees only when the
// span reaches the end. A non-empty side must sit exactly around the span. This is the
// position-hint shape - "does the stored context agree where the caller already located the
// span" - used by anchor validation and client paint verification.
export function contextAgreesAt(
  text: string,
  span: RenderedTextSpan,
  context: RenderedTextContext,
): boolean {
  const { start, end } = span;
  const { prefix, suffix } = context;
  const prefixOk =
    prefix === ""
      ? start === 0
      : text.slice(Math.max(0, start - prefix.length), start) === prefix;
  const suffixOk =
    suffix === ""
      ? end === text.length
      : text.slice(end, end + suffix.length) === suffix;
  return prefixOk && suffixOk;
}

// Locates the single occurrence of `quote` in `text` whose surrounding context agrees with
// the stored prefix/suffix, returning its half-open span - or null when the context singles
// out zero or several occurrences (a near-repeat is never guessed at). This is the scanning
// shape - "does the stored context single out an occurrence found by scanning" - used by
// reattachment; boundary-empty context locates a span only while it still sits at that
// boundary.
export function locateUniqueContextMatch(
  text: string,
  target: RenderedTextContext & { quote: string },
): RenderedTextSpan | null {
  const { quote, prefix, suffix } = target;
  const matching = exactOccurrences(text, quote).filter((start) =>
    contextAgreesAt(
      text,
      { start, end: start + quote.length },
      { prefix, suffix },
    ),
  );
  if (matching.length !== 1) {
    return null;
  }
  const start = matching[0];
  return { start, end: start + quote.length };
}
