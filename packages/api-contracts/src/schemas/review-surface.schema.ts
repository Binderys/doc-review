import { z } from "zod";

// One word-level segment of an md source diff (base -> head). `added`/`removed`
// mark the segment's role; an unmarked segment is unchanged context. The md
// renderer (issue #8) produces these; the contract carries the shape now so that
// slice only fills the `md` arm's producer, not redefines the wire type.
export const wordDiffSegmentSchema = z.object({
  value: z.string(),
  added: z.boolean().optional(),
  removed: z.boolean().optional(),
});

// A word-level source diff: an ordered list of segments.
export const wordDiffSchema = z.array(wordDiffSegmentSchema);

// One line of a source-level diff (base -> head), addressable by line number so
// feedback can anchor to it (issue #37). `change` marks the line's role. `newLine`
// is the line's position at the PR head and is present only for `context` and
// `added` lines: a `removed` line has no head position, so it is display context,
// not a valid head anchor. `oldLine` is the base position, present for `context` and
// `removed`. The invariant is enforced here so the two-anchor contract holds at the
// wire, not just by producer convention.
export const sourceDiffLineSchema = z
  .object({
    oldLine: z.number().int().positive().optional(),
    newLine: z.number().int().positive().optional(),
    text: z.string(),
    change: z.enum(["context", "added", "removed"]),
  })
  .superRefine((line, ctx) => {
    const hasOld = line.oldLine !== undefined;
    const hasNew = line.newLine !== undefined;
    // context: both sides; added: head only; removed: base only.
    const expectOld = line.change !== "added";
    const expectNew = line.change !== "removed";
    if (hasOld !== expectOld) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `a ${line.change} line must ${expectOld ? "" : "not "}carry oldLine`,
        path: ["oldLine"],
      });
    }
    if (hasNew !== expectNew) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `a ${line.change} line must ${expectNew ? "" : "not "}carry newLine`,
        path: ["newLine"],
      });
    }
  });

// A source-level diff: an ordered list of addressable lines.
export const sourceDiffSchema = z.array(sourceDiffLineSchema);

// The per-file rendered payload, discriminated by detected `format`. Every arm is
// declared now; issue #7 only produces the `download` arm (its default renderer),
// and later slices fill the others (#8 md, #9 docx, #10 html + pdf). `renderedHead`
// and `raw` carry HTML/text as strings; `comparisonUrl` and `blobUrl` are raw-byte
// route paths with format-specific transport behavior.
const exactHeadComparisonUrlSchema = z
  .string()
  .regex(
    /^\/pr\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/[1-9]\d*\/raw\?path=[^&#]+&ref=[0-9a-f]{40}$/,
    "HTML comparison URL must target the exact-head raw route",
  );

export const filePayloadSchema = z.discriminatedUnion("format", [
  // md: a word-level source diff plus the rendered head as an HTML string (#8),
  // and a line-addressable source diff for anchoring feedback (#37). `reviewText`
  // is the Mirror's authoritative normalized review-text, produced deterministically
  // from the exact head so a rendered-text anchor can address a span of it (#63). The
  // renderer always emits it, so it is a required field of the md wire shape.
  z.object({
    format: z.literal("md"),
    diff: wordDiffSchema,
    sourceDiff: sourceDiffSchema,
    renderedHead: z.string(),
    reviewText: z.string(),
  }),
  // docx: the head converted to an HTML string; content diffs live in the md
  // mirror, so there is no diff here (#9). `reviewText` is the rendered Canonical's
  // authoritative normalized review-text, reproduced deterministically from the exact
  // head (the mammoth HTML flattened through the same block-aware tokenizer the HTML
  // arm uses) so a rendered-text anchor can address a span of it (#67) - the same role
  // `reviewText` plays for the md and html arms.
  z.object({
    format: z.literal("docx"),
    renderedHead: z.string(),
    reviewText: z.string(),
  }),
  // html: the raw file content for the sanitized copy and source review, plus an
  // exact-head comparison URL served with the browsing restrictions that prevent the
  // authored document from loading subresources (#78). The nullable field represents
  // head availability; `changedFileViewSchema` below binds null to the deleted change
  // type. The line-addressable source diff anchors source feedback (#37). `reviewText`
  // is the sanitized HTML copy's
  // authoritative normalized review-text, reproduced deterministically from the exact
  // head so a rendered-text anchor can address a span of it (#66) - the same role
  // `reviewText` plays for the md arm.
  z.object({
    format: z.literal("html"),
    raw: z.string(),
    comparisonUrl: exactHeadComparisonUrlSchema.nullable(),
    sourceDiff: sourceDiffSchema,
    reviewText: z.string(),
  }),
  // pdf: a blob/URL for the browser's native viewer (#10).
  z.object({
    format: z.literal("pdf"),
    blobUrl: z.string(),
  }),
  // download: the fallback for any format not yet rendered. `blobUrl` is the
  // route path to the file's raw bytes; `filename` is the basename. Never dropped.
  z.object({
    format: z.literal("download"),
    blobUrl: z.string(),
    filename: z.string(),
  }),
]);

// A changed file's review-surface view: its path, its change type, and its
// rendered payload. `changeType` collapses GitHub's per-file statuses to the three
// the reviewer distinguishes (renames/copies read as `modified`). This boundary also
// owns the HTML head-availability invariant: deleted HTML has no comparison URL, while
// added or modified HTML must have one.
export const changeTypeSchema = z.enum(["added", "modified", "deleted"]);

export const changedFileViewSchema = z
  .object({
    path: z.string(),
    changeType: changeTypeSchema,
    payload: filePayloadSchema,
  })
  .superRefine((file, context) => {
    if (file.payload.format !== "html") {
      return;
    }
    const hasHead = file.changeType !== "deleted";
    if (hasHead === (file.payload.comparisonUrl !== null)) {
      return;
    }
    context.addIssue({
      code: "custom",
      path: ["payload", "comparisonUrl"],
      message:
        "HTML comparison URL must be present exactly when the changed file has a head",
    });
  });

const feedbackBodySchema = z.string().min(1);
const feedbackPathSchema = z.string().min(1);
const mirrorPathSchema = feedbackPathSchema.refine(
  (path) => path.toLowerCase().endsWith(".md"),
  "Mirror feedback requires an .md path",
);
const canonicalPathSchema = feedbackPathSchema.refine(
  (path) => path.toLowerCase().endsWith(".docx"),
  "Canonical feedback requires a .docx path",
);
const pdfPathSchema = feedbackPathSchema.refine(
  (path) => path.toLowerCase().endsWith(".pdf"),
  "PDF feedback requires a .pdf path",
);
const htmlPathSchema = feedbackPathSchema.refine(
  (path) => /\.html?$/.test(path.toLowerCase()),
  "HTML feedback requires an .html or .htm path",
);
// The rendered-text formats: a Mirror's marked-token flatten (#63), the sanitized HTML
// copy's block-aware text (#66), or a rendered Canonical's mammoth-HTML block-aware text
// (#67). The rendered anchor carries this as explicit provenance so a selector's format is
// bound to its path, not merely inferred from the extension.
export const renderedTextFormatSchema = z.enum(["md", "html", "docx"]);
export type RenderedTextFormat = z.infer<typeof renderedTextFormatSchema>;

// The single owner of the path -> format mapping (one extension test): a Mirror is `.md`,
// the HTML copy is `.html`/`.htm`, a Canonical is `.docx`, anything else is neither. The
// client uses this to stamp a fresh selector's format from the document it annotates; the
// server contract then enforces the binding.
export function renderedFormatForPath(path: string): RenderedTextFormat | null {
  const lower = path.toLowerCase();
  if (lower.endsWith(".md")) return "md";
  if (/\.html?$/.test(lower)) return "html";
  if (lower.endsWith(".docx")) return "docx";
  return null;
}

// The rendered path <-> format binding, shared by the wire contract, the server validation
// seam, and the persisted-state schema (one predicate, not three). Derived from the single
// mapping above so a future format touches one place.
export function renderedPathMatchesFormat(
  format: RenderedTextFormat,
  path: string,
): boolean {
  return renderedFormatForPath(path) === format;
}

const mirrorRangeFeedbackShape = {
  scope: z.literal("range"),
  path: mirrorPathSchema,
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  quote: z.string(),
  body: feedbackBodySchema,
};

export const mirrorRangeFeedbackSchema = z
  .object(mirrorRangeFeedbackShape)
  .strict()
  .refine((anchor) => anchor.endLine >= anchor.startLine, {
    message: "endLine must be greater than or equal to startLine",
    path: ["endLine"],
  });

// A rendered-text selector (#63 Mirror, #66 HTML, #67 Canonical). Where the source-range
// Mirror anchor (`scope: "range"`) addresses .md source lines, this addresses a span of a
// rendered document's authoritative normalized review-text - the deterministic text the
// server reproduces from the exact head (a Mirror's marked-token flatten, the sanitized
// HTML copy's block-aware text, or a Canonical's mammoth-HTML block-aware text). `format`
// is the document's rendered format, bound to `path` so an HTML selector with a Mirror
// path (or vice versa) is rejected at the wire. `quote`
// (with `prefix`/`suffix` context) is the decision-bearing selector; `start`/`end` are
// 0-based half-open position hints into that review-text, never a substitute for the
// quote. `selectorVersion` pins the selector format so an unsupported version is rejected.
// Strict, so an opaque annotation object (e.g. a persisted Recogito target) fails to parse.
const renderedTextFeedbackShape = {
  scope: z.literal("rendered"),
  format: renderedTextFormatSchema,
  path: feedbackPathSchema,
  quote: z.string().min(1),
  prefix: z.string(),
  suffix: z.string(),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  selectorVersion: z.literal(1),
  body: feedbackBodySchema,
};

// The two invariants the rendered shape carries beyond its field types, applied wherever
// the rendered arm is built (request, surface comment, artifact comment): end after start,
// and the path bound to the declared format so provenance holds on every arm.
const renderedTextEndAfterStart = (anchor: {
  start: number;
  end: number;
}): boolean => anchor.end > anchor.start;
const renderedTextEndAfterStartError = {
  message: "end must be greater than start",
  path: ["end"],
};
const renderedTextPathBound = (anchor: {
  format: RenderedTextFormat;
  path: string;
}): boolean => renderedPathMatchesFormat(anchor.format, anchor.path);
const renderedTextPathBoundError = {
  message: "path must match the rendered format",
  path: ["path"],
};

export const renderedTextFeedbackSchema = z
  .object(renderedTextFeedbackShape)
  .strict()
  .refine(renderedTextEndAfterStart, renderedTextEndAfterStartError)
  .refine(renderedTextPathBound, renderedTextPathBoundError);

const canonicalFileFeedbackShape = {
  scope: z.literal("file"),
  path: canonicalPathSchema,
  locator: z
    .object({
      section: z.string().min(1),
      quote: z.string().min(1),
    })
    .strict(),
  body: feedbackBodySchema,
};

export const canonicalFileFeedbackSchema = z
  .object(canonicalFileFeedbackShape)
  .strict();

const pdfFileFeedbackShape = {
  scope: z.literal("file"),
  path: pdfPathSchema,
  body: feedbackBodySchema,
};

export const pdfFileFeedbackSchema = z.object(pdfFileFeedbackShape).strict();

const htmlLineFeedbackShape = {
  scope: z.literal("line"),
  path: htmlPathSchema,
  line: z.number().int().positive(),
  quote: z.string(),
  body: feedbackBodySchema,
};

export const htmlLineFeedbackSchema = z.object(htmlLineFeedbackShape).strict();

const reviewLevelFeedbackShape = {
  scope: z.literal("review"),
  body: feedbackBodySchema,
};

export const reviewLevelFeedbackSchema = z
  .object(reviewLevelFeedbackShape)
  .strict();

// The request body accepted by the review controller. The two `file` arms are
// deliberately distinguished by the canonical locator: a PDF accepts only its
// file path, while a Canonical must carry section-plus-nearby-quote context.
export const feedbackAnchorSchema = z.union([
  mirrorRangeFeedbackSchema,
  renderedTextFeedbackSchema,
  canonicalFileFeedbackSchema,
  pdfFileFeedbackSchema,
  htmlLineFeedbackSchema,
  reviewLevelFeedbackSchema,
]);

const serverFeedbackShape = {
  id: z.string().min(1),
  headSha: z.string().min(1),
  roundNumber: z.number().int().positive(),
  createdAt: z.string().datetime(),
  carriedForward: z.boolean(),
  drifted: z.boolean(),
};

// The reviewer-driven round lifecycle (#39, #40). A new exact head starts `open`,
// whether or not the previous round was finished; the reviewer freezes it
// (`finished`) or approves it (`approved`, terminal).
export const roundStatusSchema = z.enum(["open", "finished", "approved"]);

// The PATCH body that transitions the current round (#39). `review/current` is the
// round resource; the reviewer partial-updates its `status` to a terminal state.
// `open` is the initial state, never a PATCH target, so only `finished` and
// `approved` are accepted; strict so a malformed body fails to parse.
export const roundTransitionSchema = z
  .object({ status: z.enum(["finished", "approved"]) })
  .strict();

// The PATCH body that resolves one comment (#39). Resolution is one-directional, so
// the only accepted shape is `{ resolved: true }`; strict so any other body (an
// extra field, or `resolved: false`) fails to parse.
export const commentResolutionSchema = z
  .object({ resolved: z.literal(true) })
  .strict();

// The surface comment adds a server-set `resolved` flag so the reviewer UI can show
// resolution state and gate the Resolve control. Resolution is reviewer-driven and
// only while the round is open; creation always yields `resolved: false`.
const surfaceCommentShape = {
  ...serverFeedbackShape,
  resolved: z.boolean(),
};

export const reviewCommentSchema = z.union([
  z
    .object({ ...mirrorRangeFeedbackShape, ...surfaceCommentShape })
    .strict()
    .refine((anchor) => anchor.endLine >= anchor.startLine, {
      message: "endLine must be greater than or equal to startLine",
      path: ["endLine"],
    }),
  z
    .object({ ...renderedTextFeedbackShape, ...surfaceCommentShape })
    .strict()
    .refine(renderedTextEndAfterStart, renderedTextEndAfterStartError)
    .refine(renderedTextPathBound, renderedTextPathBoundError),
  z.object({ ...canonicalFileFeedbackShape, ...surfaceCommentShape }).strict(),
  z.object({ ...pdfFileFeedbackShape, ...surfaceCommentShape }).strict(),
  z.object({ ...htmlLineFeedbackShape, ...surfaceCommentShape }).strict(),
  z.object({ ...reviewLevelFeedbackShape, ...surfaceCommentShape }).strict(),
]);

export const reviewRoundSchema = z.object({
  number: z.number().int().positive(),
  headSha: z.string().min(1),
  createdAt: z.string().datetime(),
  status: roundStatusSchema,
  comments: z.array(reviewCommentSchema),
});

// The agent-facing finish artifact's comment: the anchor arms plus the server-owned
// keys, WITHOUT `resolved`. Strict at every level so a planted `resolved`/`reply`/
// `approve` field fails to parse - the artifact carries nothing that can mutate the
// review (#39 AC5). This is the exact serverFeedbackShape comment, read-only.
export const reviewArtifactCommentSchema = z.union([
  z
    .object({ ...mirrorRangeFeedbackShape, ...serverFeedbackShape })
    .strict()
    .refine((anchor) => anchor.endLine >= anchor.startLine, {
      message: "endLine must be greater than or equal to startLine",
      path: ["endLine"],
    }),
  z
    .object({ ...renderedTextFeedbackShape, ...serverFeedbackShape })
    .strict()
    .refine(renderedTextEndAfterStart, renderedTextEndAfterStartError)
    .refine(renderedTextPathBound, renderedTextPathBoundError),
  z.object({ ...canonicalFileFeedbackShape, ...serverFeedbackShape }).strict(),
  z.object({ ...pdfFileFeedbackShape, ...serverFeedbackShape }).strict(),
  z.object({ ...htmlLineFeedbackShape, ...serverFeedbackShape }).strict(),
  z.object({ ...reviewLevelFeedbackShape, ...serverFeedbackShape }).strict(),
]);

// The read-only artifact a finished (or approved) round exposes to the agent. Strict
// so it can carry no field that resolves/replies/approves; `comments` holds ONLY the
// round's unresolved comments and is empty when `approved`.
export const reviewArtifactSchema = z
  .object({
    pr: z.string().min(1),
    headSha: z.string().min(1),
    reviewRound: z.number().int().positive(),
    approved: z.boolean(),
    comments: z.array(reviewArtifactCommentSchema),
  })
  .strict();

// Wire shape of `GET /pr/:owner/:repo/:number`: PR metadata, the ordered changed
// files, and retained exact-head review rounds. `sourceBranchUrl` links the PR head
// branch on GitHub; `githubUrl` is the "open on GitHub" deep link to the PR itself.
export const reviewSurfaceResponseSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  description: z.string(),
  sourceBranchUrl: z.string().url(),
  githubUrl: z.string().url(),
  files: z.array(changedFileViewSchema),
  currentRound: reviewRoundSchema,
  rounds: z.array(reviewRoundSchema),
});

export type WordDiffSegment = z.infer<typeof wordDiffSegmentSchema>;
export type WordDiff = z.infer<typeof wordDiffSchema>;
export type SourceDiffLine = z.infer<typeof sourceDiffLineSchema>;
export type SourceDiff = z.infer<typeof sourceDiffSchema>;
export type FilePayload = z.infer<typeof filePayloadSchema>;
export type ChangeType = z.infer<typeof changeTypeSchema>;
export type ChangedFileView = z.infer<typeof changedFileViewSchema>;
export type FeedbackAnchor = z.infer<typeof feedbackAnchorSchema>;
export type RenderedTextFeedback = z.infer<typeof renderedTextFeedbackSchema>;
export type ReviewComment = z.infer<typeof reviewCommentSchema>;
export type RoundStatus = z.infer<typeof roundStatusSchema>;
export type RoundTransition = z.infer<typeof roundTransitionSchema>;
export type CommentResolution = z.infer<typeof commentResolutionSchema>;
export type ReviewRound = z.infer<typeof reviewRoundSchema>;
export type ReviewArtifactComment = z.infer<typeof reviewArtifactCommentSchema>;
export type ReviewArtifact = z.infer<typeof reviewArtifactSchema>;
export type ReviewSurfaceResponse = z.infer<typeof reviewSurfaceResponseSchema>;
