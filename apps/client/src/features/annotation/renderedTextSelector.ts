import {
  renderedFormatForPath,
  type RenderedTextFeedback,
  type ReviewComment,
} from "@doc-review/api-contracts";
import { contextAgreesAt, exactOccurrences } from "@doc-review/shared";
import type {
  RawRenderedSelection,
  RenderedHighlight,
  RenderedTextSelection,
} from "./renderedAnnotator";

// How much surrounding text to capture as decision-bearing prefix/suffix context. The
// exact quote is authoritative; this window disambiguates a repeated quote without
// carrying the whole document.
const CONTEXT_WINDOW = 32;

// Collapses every run of whitespace to a single space and trims. The rendered Mirror
// HTML's visible text and the authoritative normalized review-text (a #63 marked-token
// flatten of the same head) are INDEPENDENTLY derived: they may differ by whitespace,
// by block-boundary joins, and by literal raw HTML the flatten retains but the DOM
// strips. Nothing enforces they agree, so a position or occurrence index computed in
// one text is never transported into the other. Instead every location is decided by
// the exact quote plus prefix/suffix context, matched whitespace-insensitively against
// the target text; on divergence or ambiguity the match fails closed to "no location".
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// Builds a whitespace-collapsed view of `text` plus a map from each collapsed-view
// index back to the original index, so a match in the collapsed view resolves to exact
// original offsets. A whitespace run collapses to one space mapped at its first char.
function normalizeWithMap(text: string): { normalized: string; map: number[] } {
  let normalized = "";
  const map: number[] = [];
  let inWhitespace = false;

  for (let index = 0; index < text.length; index += 1) {
    if (/\s/.test(text[index])) {
      // Skip a leading whitespace run; collapse an interior run to a single space.
      if (!inWhitespace && normalized.length > 0) {
        normalized += " ";
        map.push(index);
      }
      inWhitespace = true;
    } else {
      normalized += text[index];
      map.push(index);
      inWhitespace = false;
    }
  }

  // A trailing whitespace run may have appended a dangling space; drop it.
  if (normalized.endsWith(" ")) {
    normalized = normalized.slice(0, -1);
    map.pop();
  }

  return { normalized, map };
}

// A span of `text` in its own offsets, half-open.
export type QuoteSpan = { start: number; end: number };

// The decision-bearing shape both a raw selection and a stored highlight satisfy: the
// exact quote plus optional prefix/suffix context. `findQuoteSpan` locates by this
// alone, so it composes with either without an untyped cast.
export type QuoteWithContext = {
  quote: string;
  prefix?: string;
  suffix?: string;
};

type CollapsedMatches = {
  normalized: string;
  map: number[];
  query: string;
  starts: number[];
};

function collapsedMatches(
  text: string,
  rawQuote: string,
): CollapsedMatches | null {
  const query = collapseWhitespace(rawQuote);
  if (query.length === 0) return null;
  const { normalized, map } = normalizeWithMap(text);
  return {
    normalized,
    map,
    query,
    starts: exactOccurrences(normalized, query),
  };
}

function toSpan(matches: CollapsedMatches, collapsedStart: number): QuoteSpan {
  return {
    start: matches.map[collapsedStart],
    end: matches.map[collapsedStart + matches.query.length - 1] + 1,
  };
}

// Picks the single occurrence whose surrounding context agrees with the stored (or
// observed) prefix/suffix, or null when the context matches zero or several - an
// ambiguous location is never guessed at. An empty prefix agrees only at the collapsed
// start of the text, an empty suffix only at its collapsed end, so empty context is a
// boundary claim rather than a wildcard.
function uniqueContextMatch(
  matches: CollapsedMatches,
  target: QuoteWithContext,
): number | null {
  const prefix = collapseWhitespace(target.prefix ?? "");
  const suffix = collapseWhitespace(target.suffix ?? "");

  const matching = matches.starts.filter((start) => {
    // Trim both sides so a boundary space (present on one side only) never defeats the
    // comparison; the words around the quote are what disambiguate.
    const before = collapseWhitespace(matches.normalized.slice(0, start));
    const after = collapseWhitespace(
      matches.normalized.slice(start + matches.query.length),
    );
    const prefixOk = prefix === "" ? before === "" : before.endsWith(prefix);
    const suffixOk = suffix === "" ? after === "" : after.startsWith(suffix);
    return prefixOk && suffixOk;
  });
  return matching.length === 1 ? matching[0] : null;
}

/**
 * Locates a selection's exact word content in `text` and returns its span in `text`'s
 * own offsets, reconciling whitespace. A repeated match anchors only when its context
 * singles one occurrence out. A unique match anchors on the quote alone by default (the
 * fresh-selection path, whose context is read from the same text); with
 * `requireContext`, a unique match must ALSO agree with the stored context (the painting
 * path, where the stored context was already proven against the review-text, so a
 * unique-but-wrong match from residual divergence is refused rather than painted).
 * Returns null when the selection is empty, absent, or ambiguous - never a guess.
 */
export function findQuoteSpan(
  text: string,
  target: QuoteWithContext,
  options?: { requireContext?: boolean },
): QuoteSpan | null {
  const matches = collapsedMatches(text, target.quote);
  if (!matches || matches.starts.length === 0) return null;
  if (matches.starts.length === 1 && !options?.requireContext) {
    return toSpan(matches, matches.starts[0]);
  }

  const chosen = uniqueContextMatch(matches, target);
  return chosen === null ? null : toSpan(matches, chosen);
}

/**
 * Turns a raw rendered selection (the exact selected text, and the block-aware text the
 * adapter saw immediately around it in the rendered document) into the durable,
 * doc-review-owned selector against the authoritative normalized review-text. The returned
 * quote and positions are verbatim slices of the review-text, so the server's
 * quote-in-head validation and later reattachment both hold.
 *
 * Context agreement is REQUIRED even when the quote matches the review-text exactly once
 * (`requireContext`): the rendered document and the review-text are independently derived
 * and can diverge (a residual tokenizer edge case, a custom element the two sides treat
 * differently), so a selection whose observed context disagrees with the review-text must
 * fail closed rather than bind to whatever single occurrence the review-text happens to
 * carry - the same fail-closed invariant the painting path holds (#64), enforced here at
 * submission. Returns null when the selection is empty, absent, or its context disagrees.
 */
export function locateSelection(
  reviewText: string,
  selection: RawRenderedSelection,
): RenderedTextSelection | null {
  const span = findQuoteSpan(reviewText, selection, { requireContext: true });
  if (!span) return null;

  return {
    quote: reviewText.slice(span.start, span.end),
    prefix: reviewText.slice(
      Math.max(0, span.start - CONTEXT_WINDOW),
      span.start,
    ),
    suffix: reviewText.slice(span.end, span.end + CONTEXT_WINDOW),
    start: span.start,
    end: span.end,
  };
}

// Builds the wire anchor a rendered-text draft submits through the shared local
// feedback lifecycle. The selector version is pinned by the contract; the caller owns
// the document path and the reviewer's feedback body. `format` is stamped from the path
// (the document the reviewer annotated), and the server contract enforces the binding.
export function buildRenderedTextAnchor(params: {
  path: string;
  selection: RenderedTextSelection;
  body: string;
}): RenderedTextFeedback {
  const { path, selection, body } = params;
  const format = renderedFormatForPath(path);
  if (!format) {
    throw new Error(
      `Rendered-text feedback requires a Mirror, HTML, or Canonical path, got: ${path}`,
    );
  }
  return {
    scope: "rendered",
    format,
    path,
    quote: selection.quote,
    prefix: selection.prefix,
    suffix: selection.suffix,
    start: selection.start,
    end: selection.end,
    selectorVersion: 1,
    body,
  };
}

// A rendered-scope comment on this document, narrowed from the surface comment union.
export type RenderedComment = Extract<ReviewComment, { scope: "rendered" }>;

export function isRenderedComment(
  comment: ReviewComment,
): comment is RenderedComment {
  return comment.scope === "rendered";
}

/**
 * Decides whether a stored rendered-text comment is verified against the current
 * normalized review-text - the "should this comment have a highlight" gate. A comment
 * the server marked drifted, whose stored span no longer holds its exact quote, or whose
 * stored prefix/suffix no longer sit around that position is unverified: it keeps its
 * quote in the rail but yields no highlight (issue #64 AC5). A verified comment yields
 * its quote plus that same decision-bearing context, which the adapter then matches
 * against the independently-derived rendered document to decide WHERE to paint - so no
 * position or occurrence index is ever transported between the two texts. The server
 * owns drift state; this is the client's guard against ever verifying an unverified
 * position.
 */
export function verifyRenderedComment(
  reviewText: string,
  comment: RenderedComment,
): RenderedHighlight | null {
  if (comment.drifted) return null;
  const { start, end, quote, prefix, suffix, id } = comment;
  if (start < 0 || end > reviewText.length) return null;
  if (reviewText.slice(start, end) !== quote) return null;
  // The stored prefix/suffix must sit exactly around this position, empty context read as a
  // document-boundary claim - decided by the shared matching core (`@doc-review/shared`), the
  // same check the server anchor validator and reattachment seam apply (spec #56; the #68
  // boundary treatment). This keeps a stale position landing on a different occurrence of
  // the same quote from painting.
  if (!contextAgreesAt(reviewText, { start, end }, { prefix, suffix }))
    return null;
  return { id, quote, prefix, suffix };
}
