import type { FeedbackAnchor } from "@doc-review/api-contracts";
import { contextAgreesAt } from "@doc-review/shared";
import { BadRequestException } from "@nestjs/common";
import type { ChangedFile } from "../dashboard/github/github-source";
import {
  addressableHeadLines,
  addressedHtmlLine,
  addressedMirrorRange,
  reproduceRenderedReviewText,
} from "./head-text";

// The creation-time anchor gate, split per scope behind a thin dispatcher on
// `anchor.scope` (issue #3). Each scope arm validates the submitted anchor against the
// exact PR head and rejects a malformed or mispositioned one with a `BadRequestException`
// whose message names the exact failure. The sibling non-throwing drift predicate
// (`ReviewService.reconcileAnchor`) decides the SAME addressed-head content through the
// shared helpers in `head-text.ts`, so the two cannot silently diverge on what a range,
// line, or reproduced review-text addresses.

// The seam through which each validator reads the exact head: the addressed document's
// raw HEAD bytes. The dispatcher binds this to the live `GitHubSource` + head SHA; a test
// binds it to an in-memory head. Only the arms that address head content call it, so a
// pure extension gate (a PDF, a Canonical locator) never touches the network.
export type FetchHeadBytes = (path: string) => Promise<Buffer>;

type RangeAnchor = Extract<FeedbackAnchor, { scope: "range" }>;
type RenderedAnchor = Extract<FeedbackAnchor, { scope: "rendered" }>;
type LineAnchor = Extract<FeedbackAnchor, { scope: "line" }>;
type FileAnchor = Extract<FeedbackAnchor, { scope: "file" }>;

// The thin dispatcher. A review-level anchor addresses no document and passes; every
// other scope must first address a changed document, then satisfies its scope's gate.
export async function validateFeedbackAnchor(
  anchor: FeedbackAnchor,
  changedFiles: ChangedFile[],
  fetchHeadBytes: FetchHeadBytes,
): Promise<void> {
  if (anchor.scope === "review") {
    return;
  }

  if (!changedFiles.some((file) => file.path === anchor.path)) {
    throw new BadRequestException("Feedback path is not a changed document");
  }

  if (anchor.scope === "range") {
    return validateRangeAnchor(anchor, fetchHeadBytes);
  }
  if (anchor.scope === "rendered") {
    return validateRenderedAnchor(anchor, changedFiles, fetchHeadBytes);
  }
  if (anchor.scope === "line") {
    return validateLineAnchor(anchor, fetchHeadBytes);
  }
  return validateFileAnchor(anchor);
}

// A Mirror source-range anchor: a `.md` path whose inclusive line range sits inside the
// head and whose quote matches the addressed head lines exactly.
async function validateRangeAnchor(
  anchor: RangeAnchor,
  fetchHeadBytes: FetchHeadBytes,
): Promise<void> {
  if (!anchor.path.toLowerCase().endsWith(".md")) {
    throw new BadRequestException("Range feedback requires a Mirror");
  }
  const bytes = await fetchHeadBytes(anchor.path);
  const lines = addressableHeadLines(bytes.toString("utf8"));
  if (anchor.endLine > lines.length) {
    throw new BadRequestException("Mirror range is outside the PR head");
  }
  if (
    addressedMirrorRange(lines, anchor.startLine, anchor.endLine) !==
    anchor.quote
  ) {
    throw new BadRequestException(
      "Mirror quote must match the addressed head lines exactly",
    );
  }
}

// A rendered-text anchor (Mirror `.md`, HTML `.html`/`.htm`, or Canonical `.docx`,
// already bound by the wire contract). A deleted document has no head to reproduce a
// review-text from, so it can never address a rendered quote.
async function validateRenderedAnchor(
  anchor: RenderedAnchor,
  changedFiles: ChangedFile[],
  fetchHeadBytes: FetchHeadBytes,
): Promise<void> {
  const changedFile = changedFiles.find((file) => file.path === anchor.path);
  if (changedFile?.status === "removed") {
    throw new BadRequestException(
      "Rendered-text feedback requires a live document head",
    );
  }
  const bytes = await fetchHeadBytes(anchor.path);
  const reviewText = await reproduceRenderedReviewText(anchor.format, bytes);
  if (anchor.end > reviewText.length) {
    throw new BadRequestException("Rendered-text range is outside the PR head");
  }
  // Position hints are hints only: the quote and its immediate prefix/suffix context
  // must appear at them in the authoritative review-text, or the anchor is rejected (a
  // hint never overrides a selector mismatch).
  if (reviewText.slice(anchor.start, anchor.end) !== anchor.quote) {
    throw new BadRequestException(
      "Rendered-text quote must match the reproduced head exactly",
    );
  }
  // Prefix/suffix are decision-bearing, decided by the shared matching core
  // (`@doc-review/shared` `contextAgreesAt`) at the stored position hint: an EMPTY prefix
  // is a claim that the span starts the document, not a wildcard that matches any
  // mid-document position, and an empty suffix a claim that it ends the document; a
  // non-empty side must sit exactly around the span. This keeps a stale/forged empty
  // context from vouching for a mid-document span, and shares one implementation with
  // the reattachment seam and the client paint gate so the three cannot disagree.
  if (
    !contextAgreesAt(
      reviewText,
      { start: anchor.start, end: anchor.end },
      { prefix: anchor.prefix, suffix: anchor.suffix },
    )
  ) {
    throw new BadRequestException(
      "Rendered-text context must match the reproduced head exactly",
    );
  }
}

// An HTML source-line anchor: an `.html`/`.htm` path whose quote matches the addressed
// head line exactly.
async function validateLineAnchor(
  anchor: LineAnchor,
  fetchHeadBytes: FetchHeadBytes,
): Promise<void> {
  if (!/\.html?$/.test(anchor.path.toLowerCase())) {
    throw new BadRequestException("Line feedback requires HTML source");
  }
  const bytes = await fetchHeadBytes(anchor.path);
  const lines = addressableHeadLines(bytes.toString("utf8"));
  if (addressedHtmlLine(lines, anchor.line) !== anchor.quote) {
    throw new BadRequestException(
      "HTML quote must match the addressed head line exactly",
    );
  }
}

// A whole-file anchor. The two `file` arms are distinguished by the Canonical locator: a
// section-plus-quote locator requires a Canonical (`.docx`); a bare file path requires a
// PDF. The wire contract already parses the arms, so this only pins the path's format.
function validateFileAnchor(anchor: FileAnchor): void {
  const lowerPath = anchor.path.toLowerCase();
  if ("locator" in anchor) {
    if (!lowerPath.endsWith(".docx")) {
      throw new BadRequestException(
        "Section-plus-quote feedback requires a Canonical",
      );
    }
    return;
  }
  if (!lowerPath.endsWith(".pdf")) {
    throw new BadRequestException(
      "File feedback without a locator requires PDF",
    );
  }
}
