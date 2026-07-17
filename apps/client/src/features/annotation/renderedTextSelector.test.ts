import { renderedTextFeedbackSchema } from "@doc-review/api-contracts";
import { describe, expect, it } from "vitest";
import {
  buildRenderedTextAnchor,
  locateSelection,
  verifyRenderedComment,
  type RenderedComment,
} from "./renderedTextSelector";

const reviewText =
  "The Bandersnatch metric holds firm.\nA later Bandersnatch metric wobbles.";
const secondOccurrence = reviewText.indexOf(
  "Bandersnatch metric",
  reviewText.indexOf("Bandersnatch metric") + 1,
);

describe("locateSelection", () => {
  it("captures distinct prefix, suffix, start, and end around a unique quote", () => {
    // A real selection always carries the block-aware context the adapter observed; the
    // returned prefix/suffix are the review-text's own slices around the located span.
    const selection = locateSelection(reviewText, {
      quote: "holds firm",
      prefix: "Bandersnatch metric ",
      suffix: ".",
    });
    expect(selection).toEqual({
      quote: "holds firm",
      prefix: "The Bandersnatch metric ",
      suffix: ".\nA later Bandersnatch metric wo",
      start: 24,
      end: 34,
    });
  });

  it("anchors the document-start quote with an empty prefix and zero start", () => {
    const selection = locateSelection(reviewText, {
      quote: "The Bandersnatch metric",
      prefix: "",
      suffix: "holds",
    });
    expect(selection?.start).toBe(0);
    expect(selection?.prefix).toBe("");
  });

  it("reconciles whitespace between the rendered selection and the review-text", () => {
    // The rendered document's visible text may carry different whitespace than the
    // normalized review-text; matching by word content still resolves to exact offsets.
    const selection = locateSelection(reviewText, {
      quote: "Bandersnatch   metric\n  holds  firm",
      prefix: "The",
      suffix: ".",
    });
    expect(selection?.start).toBe(4);
    expect(selection?.end).toBe(34);
    expect(selection?.quote).toBe("Bandersnatch metric holds firm");
  });

  it("uses the surrounding context to pick the intended repeat", () => {
    const first = locateSelection(reviewText, {
      quote: "Bandersnatch metric",
      prefix: "The ",
      suffix: " holds",
    });
    const second = locateSelection(reviewText, {
      quote: "Bandersnatch metric",
      prefix: "A later ",
      suffix: " wobbles",
    });
    expect(first?.start).toBe(4);
    expect(second?.start).toBe(secondOccurrence);
  });

  it("refuses to anchor an ambiguous repeat rather than guessing", () => {
    // No context, and context matching neither occurrence: both must fail to anchor
    // instead of silently taking the first occurrence.
    expect(
      locateSelection(reviewText, { quote: "Bandersnatch metric" }),
    ).toBeNull();
    expect(
      locateSelection(reviewText, {
        quote: "Bandersnatch metric",
        prefix: "Nonexistent ",
        suffix: " context",
      }),
    ).toBeNull();
  });

  it("refuses a unique-quote selection whose observed context disagrees (fail-closed on divergence)", () => {
    // The review-text carries "Pick me" once, preceded by "other". A selection of that
    // same quote whose OBSERVED context is a different surrounding (a custom-element
    // occurrence the browser DOM shows but the review-text does not - the script-x
    // divergence class) must refuse rather than bind to the review-text's sole occurrence
    // and then paint the wrong DOM occurrence. This closes the class at submission (#66).
    const serverText = "other\nPick me";
    expect(
      locateSelection(serverText, {
        quote: "Pick me",
        prefix: "",
        suffix: "other",
      }),
    ).toBeNull();
  });

  it("still anchors an ordinary unique selection whose context agrees", () => {
    // Regression for the fail-closed tightening: a genuine unique selection whose observed
    // context matches the review-text still anchors normally.
    const serverText = "other\nPick me";
    const located = locateSelection(serverText, {
      quote: "Pick me",
      prefix: "other",
      suffix: "",
    });
    expect(located?.start).toBe(serverText.indexOf("Pick me"));
    expect(located?.quote).toBe("Pick me");
  });

  it("returns null for an empty selection or a quote absent from the review-text", () => {
    expect(locateSelection(reviewText, { quote: "" })).toBeNull();
    expect(
      locateSelection(reviewText, { quote: "Jabberwock ratio" }),
    ).toBeNull();
  });

  it("produces a selector the shared contract accepts", () => {
    const selection = locateSelection(reviewText, {
      quote: "holds firm",
      prefix: "metric",
      suffix: ".",
    });
    expect(selection).not.toBeNull();
    const anchor = buildRenderedTextAnchor({
      path: "deliverables/memo.md",
      selection: selection!,
      body: "Tie this claim to the rendered text.",
    });
    expect(renderedTextFeedbackSchema.safeParse(anchor).success).toBe(true);
  });
});

// A rendered-scope surface comment, with the server-owned keys the contract requires.
// Prefix/suffix default to the real review-text context around the stored span.
function renderedComment(
  overrides: Partial<RenderedComment> & Pick<RenderedComment, "quote">,
): RenderedComment {
  const quote = overrides.quote;
  const start = overrides.start ?? reviewText.indexOf(quote);
  const end = overrides.end ?? start + quote.length;
  const base: RenderedComment = {
    scope: "rendered",
    format: "md",
    path: "deliverables/memo.md",
    quote,
    prefix: reviewText.slice(Math.max(0, start - 8), start),
    suffix: reviewText.slice(end, end + 8),
    start,
    end,
    selectorVersion: 1,
    body: "Stored feedback.",
    id: "comment-verify",
    headSha: "head-verify",
    roundNumber: 1,
    createdAt: "2026-07-14T00:00:00.000Z",
    resolved: false,
    carriedForward: false,
    drifted: false,
  };
  return { ...base, ...overrides };
}

describe("verifyRenderedComment", () => {
  it("yields the quote and occurrence identity when quote and context still hold", () => {
    const comment = renderedComment({ id: "c1", quote: "holds firm" });
    // Verification yields the decision-bearing selector (quote + context), no index.
    expect(verifyRenderedComment(reviewText, comment)).toEqual({
      id: "c1",
      quote: "holds firm",
      prefix: comment.prefix,
      suffix: comment.suffix,
    });
  });

  it("verifies the second occurrence of a repeated quote by its stored span and context", () => {
    const comment = renderedComment({
      id: "c-second",
      quote: "Bandersnatch metric",
      start: secondOccurrence,
      end: secondOccurrence + "Bandersnatch metric".length,
    });
    expect(verifyRenderedComment(reviewText, comment)).toEqual({
      id: "c-second",
      quote: "Bandersnatch metric",
      prefix: comment.prefix,
      suffix: comment.suffix,
    });
  });

  it("verifies a legitimate document-start comment with an empty prefix", () => {
    const comment = renderedComment({
      id: "c-start",
      quote: "The Bandersnatch metric",
      start: 0,
      prefix: "",
      suffix: " holds",
    });
    expect(verifyRenderedComment(reviewText, comment)).toEqual({
      id: "c-start",
      quote: "The Bandersnatch metric",
      prefix: "",
      suffix: " holds",
    });
  });

  it("draws no highlight for a server-drifted comment (quote stays in the rail)", () => {
    const comment = renderedComment({
      id: "c2",
      quote: "holds firm",
      drifted: true,
    });
    expect(verifyRenderedComment(reviewText, comment)).toBeNull();
  });

  it("draws no highlight when the stored span is not an occurrence of its quote", () => {
    const comment = renderedComment({
      id: "c3",
      quote: "holds firm",
      start: 0,
      end: 10,
      prefix: "",
      suffix: "",
    });
    expect(verifyRenderedComment(reviewText, comment)).toBeNull();
  });

  it("draws no highlight when the position drifted onto a different repeat of the quote", () => {
    // The quote occurs twice; the stored position points at the second occurrence, but
    // the stored context describes the first. Quote alone matches at the position, so
    // only the context check keeps this from painting the wrong passage (spec #56).
    const comment = renderedComment({
      id: "c5",
      quote: "Bandersnatch metric",
      start: secondOccurrence,
      end: secondOccurrence + "Bandersnatch metric".length,
      prefix: "The ",
      suffix: " holds",
    });
    expect(reviewText.slice(comment.start, comment.end)).toBe(comment.quote);
    expect(verifyRenderedComment(reviewText, comment)).toBeNull();
  });

  it("draws no highlight for empty context on a mid-text repeat (empty prefix is not vacuous)", () => {
    // A repeated quote whose stored context is empty on both sides cannot vouch for a
    // mid-text position: an empty prefix verifies only at the very document start.
    const comment = renderedComment({
      id: "c6",
      quote: "Bandersnatch metric",
      start: secondOccurrence,
      end: secondOccurrence + "Bandersnatch metric".length,
      prefix: "",
      suffix: "",
    });
    expect(verifyRenderedComment(reviewText, comment)).toBeNull();
  });
});
