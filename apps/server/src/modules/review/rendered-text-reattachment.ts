import type { RenderedTextFeedback } from "@doc-review/api-contracts";
import { locateUniqueContextMatch } from "@doc-review/shared";

// The decision-bearing fields of a stored rendered-text selector (#63 Mirror, #66 HTML),
// derived from the wire contract so this module composes with the existing selector
// rather than inventing a parallel shape. `quote` (with `prefix`/`suffix` context) is
// authoritative; `start`/`end` are 0-based half-open position hints only. This module
// is pure: it takes the selector and a normalized review-text and decides, with no
// Recogito, DOM, persistence, or format knowledge (#68 AC7).
export type RenderedTextSelector = Pick<
  RenderedTextFeedback,
  "quote" | "prefix" | "suffix" | "start" | "end"
>;

// The reattachment outcome. `reattached` carries the recomputed half-open span the
// quote now occupies (equal to the original span when unmoved, updated when moved).
// `drifted` echoes the original selector unchanged so the caller retains the stored
// evidence for a drifted comment (#68 AC4).
export type ReattachmentDecision =
  | { outcome: "reattached"; start: number; end: number }
  | { outcome: "drifted"; selector: RenderedTextSelector };

// A selector is well-formed only when its quote is non-empty and its half-open offset
// hint is a consistent, non-negative integer span the length of the quote. A hint that
// fails any of these is treated as corrupt evidence, never repaired by guessing.
function isWellFormed(selector: RenderedTextSelector): boolean {
  const { quote, start, end } = selector;
  return (
    quote.length > 0 &&
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    end > start &&
    end - start === quote.length
  );
}

/**
 * Decides how a stored rendered-text selector reattaches to a freshly normalized
 * review-text (#68). The exact quote plus prefix/suffix context decide; the stored
 * start/end are hints only. An occurrence reattaches at its recomputed span only when
 * the stored context singles it out - so a unique quote with agreeing context reattaches
 * whether unmoved or moved (empty context is a document-boundary claim, so a start- or
 * end-anchored quote reattaches only while it still sits at that boundary), while a
 * coincidental identical quote with contradicting context, an unresolvable duplicate, a
 * missing quote, a boundary claim that no longer holds, or a malformed or out-of-range
 * hint drifts, preserving the original selector as evidence. Pure and deterministic: no
 * Recogito, DOM, persistence, or document-format knowledge.
 */
export function decideRenderedTextReattachment(
  selector: RenderedTextSelector,
  reviewText: string,
): ReattachmentDecision {
  const drifted: ReattachmentDecision = { outcome: "drifted", selector };

  // A corrupt or out-of-range hint is evidence the selector cannot be trusted against
  // this text, so drift before searching rather than reattach on a lucky match.
  if (!isWellFormed(selector) || selector.end > reviewText.length) {
    return drifted;
  }

  // The shared matching core (`@doc-review/shared`) scans every exact occurrence and keeps
  // only the one the stored context singles out. Context still decides even at cardinality
  // one: a lone occurrence reattaches only when its surroundings agree with the stored
  // context. Empty context is a boundary claim (start-of-document prefix, end-of-document
  // suffix), so a boundary-anchored quote reattaches only while it still sits at that
  // boundary; a coincidental identical quote whose context contradicts the stored one, and
  // an unresolvable duplicate, both yield no unique match and drift rather than being
  // guessed at. This is the same core the anchor-validation seam and the client paint gate
  // decide from, so the three cannot disagree.
  const located = locateUniqueContextMatch(reviewText, {
    quote: selector.quote,
    prefix: selector.prefix,
    suffix: selector.suffix,
  });
  if (!located) {
    return drifted;
  }
  return { outcome: "reattached", start: located.start, end: located.end };
}
