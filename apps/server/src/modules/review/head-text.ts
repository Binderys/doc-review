import type { RenderedTextFormat } from "@doc-review/api-contracts";
import { convertCanonicalHtml } from "./renderers/canonical-html";
import { normalizeHtmlReviewText } from "./renderers/html-review-text";
import { normalizeMirrorReviewText } from "./renderers/mirror-review-text";

// The head-content helpers shared by the two seams that address a document's exact
// head: `validateAnchor` (the throwing creation-time gate, `anchor-validation.ts`) and
// `reconcileAnchor` (the non-throwing per-head drift predicate, `review.service.ts`).
// Extracting the addressed-content extraction here is the shared source that keeps the
// two from silently diverging on the arms that compute the SAME thing (a Mirror range,
// an HTML line, the reproduced rendered review-text): a change to how a range or line is
// carved from the head lands in one place for both.

// The head lines a source anchor can address: the exact head text split on either
// newline style, with a single trailing empty line (a final newline) dropped so a
// terminating newline does not fabricate an addressable blank line.
export function addressableHeadLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

// The exact head content a Mirror source-range anchor (`scope: "range"`) addresses:
// the inclusive 1-based `[startLine, endLine]` slice of the head lines, rejoined with a
// plain `\n`. Both the range validator and the range drift arm compare this against the
// stored quote, so they cannot disagree on what "the addressed head lines" are.
export function addressedMirrorRange(
  lines: string[],
  startLine: number,
  endLine: number,
): string {
  return lines.slice(startLine - 1, endLine).join("\n");
}

// The exact head content an HTML source-line anchor (`scope: "line"`) addresses: the
// single 1-based head line (`undefined` past the end). Both the line validator and the
// line drift arm compare this against the stored quote.
export function addressedHtmlLine(
  lines: string[],
  line: number,
): string | undefined {
  return lines[line - 1];
}

// Reproduces a rendered document's authoritative normalized review-text from its exact
// head bytes, by the anchor's declared format: a Mirror flattens its marked tokens, the
// sanitized HTML copy applies the same allowlist + block walk the client displays, and a
// Canonical goes through the single owner of Canonical HTML production
// (`convertCanonicalHtml`) - the SAME function the docx renderer ships the mounted HTML and
// review-text with, so the mounted HTML and this validation reproduction agree by
// construction. It takes the raw head BYTES, not decoded text, because a docx head is a
// binary zip - md/html decode to UTF-8, docx is fed to mammoth. The single owner of the
// rendered-text reproduction both the anchor validation and the drift check rely on, so a
// new supported format is added in one place. The wire contract binds `format` to `path`,
// so the format is authoritative here.
export async function reproduceRenderedReviewText(
  format: RenderedTextFormat,
  headBytes: Buffer,
): Promise<string> {
  if (format === "docx") {
    const { reviewText } = await convertCanonicalHtml(headBytes);
    return reviewText;
  }
  const headText = headBytes.toString("utf8");
  return format === "md"
    ? normalizeMirrorReviewText(headText)
    : normalizeHtmlReviewText(headText);
}
