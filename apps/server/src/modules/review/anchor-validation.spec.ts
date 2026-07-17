import type { FeedbackAnchor } from "@doc-review/api-contracts";
import { BadRequestException } from "@nestjs/common";
import type { ChangedFile } from "../dashboard/github/github-source";
import { validateFeedbackAnchor } from "./anchor-validation";
import {
  addressableHeadLines,
  addressedHtmlLine,
  addressedMirrorRange,
  reproduceRenderedReviewText,
} from "./head-text";
import { normalizeMirrorReviewText } from "./renderers/mirror-review-text";

// The #3 guard coverage: every `BadRequestException` the per-scope anchor validators
// throw has one table-driven case asserting its exact rejection message, driven through
// the thin dispatcher with an in-memory head reader (no GitHub, no Nest). The dispatcher
// gate plus the five scope arms carry the twelve distinct guard messages the wire schema
// cannot express.

const MIRROR_PATH = "deliverables/memo.md";
const MIRROR_HEAD = "Line one\nLine two\n";
const MIRROR_LINES = addressableHeadLines(MIRROR_HEAD);

const HTML_PATH = "sources/page.html";
const HTML_HEAD = "<p>Exact source line.</p>\n<p>Second line.</p>\n";
const HTML_LINES = addressableHeadLines(HTML_HEAD);

// A rendered Mirror head whose authoritative review-text drives the rendered guards; the
// offsets are derived from the same normalizer the validator reproduces with, so the
// hints address the quote exactly on the accept path.
const RENDERED_PATH = "deliverables/rendered.md";
const RENDERED_HEAD = "First paragraph.\n\nSecond paragraph about scope.\n";
const RENDERED_TEXT = normalizeMirrorReviewText(RENDERED_HEAD);
const RENDERED_QUOTE = "scope";
const RENDERED_START = RENDERED_TEXT.indexOf(RENDERED_QUOTE);
const RENDERED_END = RENDERED_START + RENDERED_QUOTE.length;
const RENDERED_PREFIX = RENDERED_TEXT.slice(
  Math.max(0, RENDERED_START - 6),
  RENDERED_START,
);
const RENDERED_SUFFIX = RENDERED_TEXT.slice(RENDERED_END, RENDERED_END + 6);

const CANONICAL_PATH = "deliverables/memo.docx";
const PDF_PATH = "deliverables/pack.pdf";

const HEAD_BYTES: Record<string, Buffer> = {
  [MIRROR_PATH]: Buffer.from(MIRROR_HEAD, "utf8"),
  [HTML_PATH]: Buffer.from(HTML_HEAD, "utf8"),
  [RENDERED_PATH]: Buffer.from(RENDERED_HEAD, "utf8"),
};

const changed = (
  path: string,
  status: ChangedFile["status"] = "modified",
): ChangedFile => ({ path, status });

const ALL_CHANGED: ChangedFile[] = [
  changed(MIRROR_PATH),
  changed(HTML_PATH),
  changed(RENDERED_PATH),
  changed(CANONICAL_PATH),
  changed(PDF_PATH),
];

// Reads planted head bytes; a path with no planted head is a test-wiring error, not a
// silent empty buffer, so an arm that should have rejected before fetching is caught.
const fetchHeadBytes = (path: string): Promise<Buffer> => {
  const bytes = HEAD_BYTES[path];
  if (!bytes) {
    throw new Error(`no planted head bytes for ${path}`);
  }
  return Promise.resolve(bytes);
};

const rejectCases: [string, FeedbackAnchor, ChangedFile[], string][] = [
  [
    "a non-review anchor addressing an unchanged document",
    { scope: "file", path: PDF_PATH, body: "b" },
    [],
    "Feedback path is not a changed document",
  ],
  [
    "a range anchor on a non-Mirror path",
    {
      scope: "range",
      path: "deliverables/memo.txt",
      startLine: 1,
      endLine: 1,
      quote: "x",
      body: "b",
    },
    [changed("deliverables/memo.txt")],
    "Range feedback requires a Mirror",
  ],
  [
    "a range beyond the head",
    {
      scope: "range",
      path: MIRROR_PATH,
      startLine: 1,
      endLine: 99,
      quote: "x",
      body: "b",
    },
    ALL_CHANGED,
    "Mirror range is outside the PR head",
  ],
  [
    "a range quote that does not match the addressed head lines",
    {
      scope: "range",
      path: MIRROR_PATH,
      startLine: 1,
      endLine: 2,
      quote: "Not the addressed lines",
      body: "b",
    },
    ALL_CHANGED,
    "Mirror quote must match the addressed head lines exactly",
  ],
  [
    "a rendered anchor on a deleted document head",
    {
      scope: "rendered",
      format: "md",
      path: RENDERED_PATH,
      quote: RENDERED_QUOTE,
      prefix: RENDERED_PREFIX,
      suffix: RENDERED_SUFFIX,
      start: RENDERED_START,
      end: RENDERED_END,
      selectorVersion: 1,
      body: "b",
    },
    [changed(RENDERED_PATH, "removed")],
    "Rendered-text feedback requires a live document head",
  ],
  [
    "a rendered range beyond the reproduced head",
    {
      scope: "rendered",
      format: "md",
      path: RENDERED_PATH,
      quote: RENDERED_QUOTE,
      prefix: RENDERED_PREFIX,
      suffix: RENDERED_SUFFIX,
      start: RENDERED_TEXT.length,
      end: RENDERED_TEXT.length + 5,
      selectorVersion: 1,
      body: "b",
    },
    ALL_CHANGED,
    "Rendered-text range is outside the PR head",
  ],
  [
    "a rendered quote that does not match the reproduced head",
    {
      scope: "rendered",
      format: "md",
      path: RENDERED_PATH,
      quote: "wrong",
      prefix: RENDERED_PREFIX,
      suffix: RENDERED_SUFFIX,
      start: RENDERED_START,
      end: RENDERED_END,
      selectorVersion: 1,
      body: "b",
    },
    ALL_CHANGED,
    "Rendered-text quote must match the reproduced head exactly",
  ],
  [
    "a rendered context that does not match the reproduced head",
    {
      scope: "rendered",
      format: "md",
      path: RENDERED_PATH,
      quote: RENDERED_QUOTE,
      prefix: "MISMATCH",
      suffix: RENDERED_SUFFIX,
      start: RENDERED_START,
      end: RENDERED_END,
      selectorVersion: 1,
      body: "b",
    },
    ALL_CHANGED,
    "Rendered-text context must match the reproduced head exactly",
  ],
  [
    "a line anchor on a non-HTML path",
    {
      scope: "line",
      path: MIRROR_PATH,
      line: 1,
      quote: "x",
      body: "b",
    },
    ALL_CHANGED,
    "Line feedback requires HTML source",
  ],
  [
    "a line quote that does not match the addressed head line",
    {
      scope: "line",
      path: HTML_PATH,
      line: 1,
      quote: "<p>Not this line</p>",
      body: "b",
    },
    ALL_CHANGED,
    "HTML quote must match the addressed head line exactly",
  ],
  [
    "a locator anchor on a non-Canonical path",
    {
      scope: "file",
      path: PDF_PATH,
      locator: { section: "Intro", quote: "nearby" },
      body: "b",
    },
    ALL_CHANGED,
    "Section-plus-quote feedback requires a Canonical",
  ],
  [
    "a locator-less file anchor on a non-PDF path",
    {
      scope: "file",
      path: CANONICAL_PATH,
      body: "b",
    },
    ALL_CHANGED,
    "File feedback without a locator requires PDF",
  ],
];

describe("validateFeedbackAnchor guard messages", () => {
  it.each(rejectCases)(
    "rejects %s",
    async (_name, anchor, changedFiles, message) => {
      await expect(
        validateFeedbackAnchor(anchor, changedFiles, fetchHeadBytes),
      ).rejects.toThrow(new BadRequestException(message));
    },
  );

  it("covers all twelve distinct guard messages exactly once", () => {
    const messages = rejectCases.map(([, , , message]) => message);
    expect(new Set(messages).size).toBe(12);
    expect(messages).toHaveLength(12);
  });
});

// The accept paths: one valid anchor per scope passes silently. A review-level anchor
// addresses no document; the file arms are pure extension gates that never read a head.
const acceptCases: [string, FeedbackAnchor, ChangedFile[]][] = [
  ["a review-level anchor (no path)", { scope: "review", body: "b" }, []],
  [
    "a Mirror source-range anchor",
    {
      scope: "range",
      path: MIRROR_PATH,
      startLine: 1,
      endLine: 2,
      quote: addressedMirrorRange(MIRROR_LINES, 1, 2),
      body: "b",
    },
    ALL_CHANGED,
  ],
  [
    "a rendered-text anchor",
    {
      scope: "rendered",
      format: "md",
      path: RENDERED_PATH,
      quote: RENDERED_QUOTE,
      prefix: RENDERED_PREFIX,
      suffix: RENDERED_SUFFIX,
      start: RENDERED_START,
      end: RENDERED_END,
      selectorVersion: 1,
      body: "b",
    },
    ALL_CHANGED,
  ],
  [
    "an HTML source-line anchor",
    {
      scope: "line",
      path: HTML_PATH,
      line: 1,
      quote: addressedHtmlLine(HTML_LINES, 1) ?? "",
      body: "b",
    },
    ALL_CHANGED,
  ],
  [
    "a Canonical section-plus-quote anchor",
    {
      scope: "file",
      path: CANONICAL_PATH,
      locator: { section: "Intro", quote: "nearby" },
      body: "b",
    },
    ALL_CHANGED,
  ],
  [
    "a PDF file anchor",
    { scope: "file", path: PDF_PATH, body: "b" },
    ALL_CHANGED,
  ],
];

describe("validateFeedbackAnchor accept paths", () => {
  it.each(acceptCases)("accepts %s", async (_name, anchor, changedFiles) => {
    await expect(
      validateFeedbackAnchor(anchor, changedFiles, fetchHeadBytes),
    ).resolves.toBeUndefined();
  });
});

// The shared head-content helpers pin the throwing validators to the non-throwing drift
// arms (`reconcileAnchor`) arm-for-arm: both seams carve the addressed head with these
// exact functions and compare against the stored quote, so a change to how a range or
// line is addressed lands in one place for both, and neither can silently drift from the
// other. The rendered arms diverge by design (creation demands the exact stored span;
// reconciliation reattaches a moved quote) yet both decode through the same
// `reproduceRenderedReviewText`, exercised here.
describe("head-text shared drift-pin helpers", () => {
  it("addresses a Mirror inclusive line range rejoined with newlines", () => {
    expect(addressedMirrorRange(["a", "b", "c"], 1, 2)).toBe("a\nb");
    expect(addressedMirrorRange(["a", "b", "c"], 2, 3)).toBe("b\nc");
  });

  it("addresses a single 1-based HTML head line", () => {
    expect(addressedHtmlLine(["a", "b", "c"], 2)).toBe("b");
    expect(addressedHtmlLine(["a", "b", "c"], 9)).toBeUndefined();
  });

  it("reproduces a Mirror review-text from its exact head bytes", async () => {
    await expect(
      reproduceRenderedReviewText("md", Buffer.from(RENDERED_HEAD, "utf8")),
    ).resolves.toBe(RENDERED_TEXT);
  });
});
