import {
  reviewArtifactSchema,
  reviewCommentSchema,
  type ChangedFileView,
  type ChangeType,
  type FeedbackAnchor,
  type RenderedTextFormat,
  type ReviewArtifact,
  type ReviewComment,
  type ReviewRound,
  type ReviewSurfaceResponse,
} from "@doc-review/api-contracts";
import { contextAgreesAt } from "@doc-review/shared";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import mammoth from "mammoth";
import type {
  ChangedFile,
  GitHubFileStatus,
  PullRequestMetadata,
} from "../dashboard/github/github-source";
import { GitHubSource } from "../dashboard/github/github-source";
import { convertCanonicalHtml } from "./renderers/canonical-html";
import { normalizeHtmlReviewText } from "./renderers/html-review-text";
import { normalizeMirrorReviewText } from "./renderers/mirror-review-text";
import { FileRendererRegistry } from "./renderers/renderer";
import { decideRenderedTextReattachment } from "./rendered-text-reattachment";
import {
  ReviewStateStore,
  type AnchorReconciliation,
  type ReconcileAnchor,
  type ReviewAnchorState,
  type ReviewCommentState,
  type ReviewRoundsState,
  type ReviewRoundState,
} from "./review-state.store";

// A file's raw HEAD bytes ready to stream, with the transport metadata the
// blob-serving route sets on the response. `contentType` is derived from the
// extension: a .pdf serves as `application/pdf` so the browser's native viewer
// opens it inline; everything else is opaque `application/octet-stream`, which the
// route sends as an attachment (the download fallback).
export type RawFile = {
  bytes: Buffer;
  contentType: string;
  filename: string;
  inline: boolean;
};

type ReviewContext = {
  slug: string;
  reviewKey: string;
  meta: PullRequestMetadata;
  changedFiles: ChangedFile[];
  reviewRounds: ReviewRoundsState;
};

type PullRequestContext = Pick<ReviewContext, "slug" | "reviewKey" | "meta">;

function transportFor(path: string): { contentType: string; inline: boolean } {
  const dot = path.lastIndexOf(".");
  const ext = dot === -1 ? "" : path.slice(dot).toLowerCase();
  if (ext === ".htm" || ext === ".html") {
    return { contentType: "text/html; charset=utf-8", inline: true };
  }
  if (ext === ".pdf") {
    return { contentType: "application/pdf", inline: true };
  }
  return { contentType: "application/octet-stream", inline: false };
}

// Collapses GitHub's per-file statuses to the three change types the reviewer
// distinguishes. `added`/`removed` map directly; every other status (modified,
// renamed, copied, changed, unchanged) reads as `modified`.
function toChangeType(status: GitHubFileStatus): ChangeType {
  switch (status) {
    case "added":
      return "added";
    case "removed":
      return "deleted";
    default:
      return "modified";
  }
}

function addressableHeadLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
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
async function reproduceRenderedReviewText(
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

function toReviewComment(state: ReviewCommentState): ReviewComment {
  return reviewCommentSchema.parse({
    ...state.anchor,
    id: state.id,
    headSha: state.headSha,
    roundNumber: state.roundNumber,
    createdAt: state.createdAt,
    resolved: state.resolved,
    carriedForward: state.carriedForward,
    drifted: state.drifted,
  });
}

// The agent-facing artifact comment input: the anchor plus the server-owned keys,
// WITHOUT `resolved`. The strict artifact schema (below) validates it, dropping
// nothing and admitting no mutation field (AC5).
function toArtifactCommentInput(state: ReviewCommentState): unknown {
  return {
    ...state.anchor,
    id: state.id,
    headSha: state.headSha,
    roundNumber: state.roundNumber,
    createdAt: state.createdAt,
    carriedForward: state.carriedForward,
    drifted: state.drifted,
  };
}

// Maps a frozen round to its read-only finish artifact. `comments` holds only the
// round's unresolved comments (empty when approved, since approval requires zero
// unresolved). The schema parse enforces strictness at the wire boundary.
function toReviewArtifact(pr: string, round: ReviewRoundState): ReviewArtifact {
  return reviewArtifactSchema.parse({
    pr,
    headSha: round.headSha,
    reviewRound: round.number,
    approved: round.status === "approved",
    comments: round.comments
      .filter((comment) => !comment.resolved)
      .map(toArtifactCommentInput),
  });
}

function toReviewAnchorState(anchor: FeedbackAnchor): ReviewAnchorState {
  if (anchor.scope === "range") {
    return {
      scope: anchor.scope,
      path: anchor.path,
      startLine: anchor.startLine,
      endLine: anchor.endLine,
      quote: anchor.quote,
      body: anchor.body,
    };
  }
  if (anchor.scope === "rendered") {
    return {
      scope: anchor.scope,
      format: anchor.format,
      path: anchor.path,
      quote: anchor.quote,
      prefix: anchor.prefix,
      suffix: anchor.suffix,
      start: anchor.start,
      end: anchor.end,
      selectorVersion: anchor.selectorVersion,
      body: anchor.body,
    };
  }
  if (anchor.scope === "line") {
    return {
      scope: anchor.scope,
      path: anchor.path,
      line: anchor.line,
      quote: anchor.quote,
      body: anchor.body,
    };
  }
  if (anchor.scope === "review") {
    return { scope: anchor.scope, body: anchor.body };
  }
  if ("locator" in anchor) {
    return {
      scope: anchor.scope,
      path: anchor.path,
      locator: {
        section: anchor.locator.section,
        quote: anchor.locator.quote,
      },
      body: anchor.body,
    };
  }
  return {
    scope: anchor.scope,
    path: anchor.path,
    body: anchor.body,
  };
}

function toReviewRound(state: ReviewRoundState): ReviewRound {
  return {
    number: state.number,
    headSha: state.headSha,
    createdAt: state.createdAt,
    status: state.status,
    comments: state.comments.map(toReviewComment),
  };
}

@Injectable()
export class ReviewService {
  constructor(
    private readonly source: GitHubSource,
    private readonly renderers: FileRendererRegistry,
    private readonly reviewState: ReviewStateStore,
  ) {}

  // Assembles a PR's review surface live per request (no cache): PR metadata plus
  // the ordered changed-file list, each file run through the renderer dispatch.
  async getReviewSurface(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<ReviewSurfaceResponse> {
    const { meta, changedFiles, reviewRounds } = await this.readReviewContext(
      owner,
      repo,
      prNumber,
    );
    const currentRound = toReviewRound(reviewRounds.currentRound);
    const rounds = reviewRounds.rounds.map(toReviewRound);

    const files: ChangedFileView[] = await Promise.all(
      changedFiles.map(async (file) => {
        const changeType = toChangeType(file.status);
        return {
          path: file.path,
          changeType,
          payload: await this.renderers.render({
            owner,
            repo,
            prNumber,
            path: file.path,
            basePath: file.previousPath ?? file.path,
            ref: meta.headSha,
            baseRef: meta.baseBranch,
            changeType,
          }),
        };
      }),
    );

    return {
      number: meta.number,
      title: meta.title,
      description: meta.description,
      sourceBranchUrl: `https://github.com/${owner}/${repo}/tree/${meta.branch}`,
      githubUrl: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
      files,
      currentRound,
      rounds,
    };
  }

  // Explicit write seam for request-triggered lifecycle reconciliation. A client
  // calls this POST action before reading the surface; mutation endpoints also use
  // it so an exact-head change cannot bypass carry-forward or drift detection.
  async reconcileReview(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<ReviewRound> {
    const { reviewRounds } = await this.reconcileReviewContext(
      owner,
      repo,
      prNumber,
    );
    return toReviewRound(reviewRounds.currentRound);
  }

  async createFeedback(
    owner: string,
    repo: string,
    prNumber: number,
    anchor: FeedbackAnchor,
  ): Promise<ReviewComment> {
    const { slug, meta, changedFiles, reviewKey } =
      await this.reconcileReviewContext(owner, repo, prNumber);

    await this.validateAnchor(slug, meta.headSha, changedFiles, anchor);

    const result = await this.reviewState.addComment(
      reviewKey,
      meta.headSha,
      toReviewAnchorState(anchor),
    );
    if (result.outcome === "not-open") {
      throw new ConflictException("The review round is frozen");
    }
    return toReviewComment(result.comment);
  }

  // Partial-updates the current round's status. `finished` freezes the open round;
  // `approved` (zero unresolved) makes it terminal. Both return the round's read-only
  // artifact. A non-open round, or approval with any unresolved comment, is an invalid
  // transition (conflict).
  async transitionRound(
    owner: string,
    repo: string,
    prNumber: number,
    status: "finished" | "approved",
  ): Promise<ReviewArtifact> {
    const { reviewKey, headSha } = await this.mutationRoundContext(
      owner,
      repo,
      prNumber,
    );
    if (status === "finished") {
      const result = await this.reviewState.finishRound(reviewKey, headSha);
      if (result.outcome === "not-open") {
        throw new ConflictException("The review round is not open");
      }
      return toReviewArtifact(reviewKey, result.round);
    }
    const result = await this.reviewState.approveRound(reviewKey, headSha);
    if (result.outcome === "not-open") {
      throw new ConflictException("The review round is not open");
    }
    if (result.outcome === "unresolved") {
      throw new ConflictException("The round has unresolved comments");
    }
    return toReviewArtifact(reviewKey, result.round);
  }

  // Resolves one comment on the current open round. A frozen round rejects
  // resolution (conflict); an unknown comment id is a not-found.
  async resolveComment(
    owner: string,
    repo: string,
    prNumber: number,
    commentId: string,
  ): Promise<ReviewComment> {
    const { reviewKey, headSha } = await this.mutationRoundContext(
      owner,
      repo,
      prNumber,
    );
    const result = await this.reviewState.resolveComment(
      reviewKey,
      headSha,
      commentId,
    );
    if (result.outcome === "not-open") {
      throw new ConflictException("The review round is not open");
    }
    if (result.outcome === "no-comment") {
      throw new NotFoundException("No such comment on the current round");
    }
    return toReviewComment(result.comment);
  }

  // Reads the current round's finish artifact. Unavailable (conflict) while the
  // round is still open; served once the round is finished or approved.
  async getCurrentArtifact(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<ReviewArtifact> {
    const { reviewKey, meta } = await this.loadOpenPullRequestWithMergeCleanup(
      owner,
      repo,
      prNumber,
    );
    const result = await this.reviewState.getRoundForArtifact(
      reviewKey,
      meta.headSha,
    );
    if (result.outcome === "unavailable") {
      throw new ConflictException(
        "The finish artifact is unavailable while the round is open",
      );
    }
    return toReviewArtifact(reviewKey, result.round);
  }

  private async mutationRoundContext(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<{ reviewKey: string; headSha: string }> {
    const { reviewKey, meta } = await this.reconcileReviewContext(
      owner,
      repo,
      prNumber,
    );
    return { reviewKey, headSha: meta.headSha };
  }

  private async readReviewContext(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<ReviewContext> {
    const context = await this.loadOpenPullRequestWithMergeCleanup(
      owner,
      repo,
      prNumber,
    );
    const changedFiles = await this.source.listChangedFiles(
      context.slug,
      prNumber,
    );
    const reviewRounds = await this.reviewState.getCurrentRound(
      context.reviewKey,
      context.meta.headSha,
    );
    if (!reviewRounds) {
      throw new ConflictException(
        "The review lifecycle must be reconciled before reading this head",
      );
    }
    return { ...context, changedFiles, reviewRounds };
  }

  private async reconcileReviewContext(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<ReviewContext> {
    const context = await this.loadOpenPullRequestWithMergeCleanup(
      owner,
      repo,
      prNumber,
    );
    const changedFiles = await this.source.listChangedFiles(
      context.slug,
      prNumber,
    );
    const reviewRounds = await this.reviewState.reconcileRound(
      context.reviewKey,
      context.meta.headSha,
      this.reconcileAnchor(context.slug, context.meta.headSha, changedFiles),
    );
    return { ...context, changedFiles, reviewRounds };
  }

  // Issue #40 deliberately makes merge cleanup request-triggered because webhooks
  // and polling are out of scope. This named helper contains that sole exceptional
  // durable write on a GET path: delete before returning the merged 404. Open-PR
  // reads never create or advance review rounds.
  private async loadOpenPullRequestWithMergeCleanup(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<PullRequestContext> {
    const slug = `${owner}/${repo}`;
    const meta = await this.source.getPullRequest(slug, prNumber);
    const reviewKey = `${slug}#${prNumber}`;
    if (meta.merged) {
      await this.reviewState.deleteReview(reviewKey);
      throw new NotFoundException("The pull request has been merged");
    }
    return { slug, reviewKey, meta };
  }

  // Builds the per-head reconciliation the store applies to each unresolved carried
  // anchor: for every scope it returns the anchor as it must persist on the new round
  // plus the server-owned drift result. A rendered anchor is reattached through the pure
  // #68 decision (its span recomputed when the exact quote plus context single out one
  // safe location, drifted otherwise, keeping the stored selector); every other scope
  // keeps its stored anchor and only recomputes the boolean drift flag, preserving the
  // source-range/line/locator semantics that predate this slice (#39/#63).
  private reconcileAnchor(
    slug: string,
    headSha: string,
    changedFiles: ChangedFile[],
  ): ReconcileAnchor {
    const changedByPath = new Map(
      changedFiles.map((file) => [file.path, file] as const),
    );
    const bytesByPath = new Map<string, Promise<Buffer>>();
    const reviewTextByPath = new Map<string, Promise<string>>();

    // The single per-head blob fetch, shared by every anchor kind: a range/line quote
    // decodes it as UTF-8 text, a rendered anchor feeds it to the format's review-text
    // reproducer (docx keeps the raw bytes for mammoth), and the Canonical locator runs
    // mammoth's raw-text extractor. One cache, so a document is fetched once per head.
    const headBytes = (path: string): Promise<Buffer> => {
      const cached = bytesByPath.get(path);
      if (cached) {
        return cached;
      }
      const loaded = this.source
        .fetchBlob(slug, headSha, path)
        .then((blob) => blob.bytes);
      bytesByPath.set(path, loaded);
      return loaded;
    };

    const headText = (path: string): Promise<string> =>
      headBytes(path).then((bytes) => bytes.toString("utf8"));

    const canonicalText = (path: string): Promise<string> =>
      headBytes(path)
        .then((bytes) => mammoth.extractRawText({ buffer: bytes }))
        .then((result) => result.value);

    // The reproduced rendered-text is memoized per path (the format is bound to the path
    // by the wire contract, so one entry per document): reconciliation runs every carried
    // anchor on the same head, and a docx anchor's mammoth conversion is derived work the
    // blob-only cache above does not cover, so a document with several rendered anchors
    // reproduces its review-text once (the #67 reviewer residual).
    const renderedReviewText = (
      path: string,
      format: RenderedTextFormat,
    ): Promise<string> => {
      const cached = reviewTextByPath.get(path);
      if (cached) {
        return cached;
      }
      const produced = headBytes(path).then((bytes) =>
        reproduceRenderedReviewText(format, bytes),
      );
      reviewTextByPath.set(path, produced);
      return produced;
    };

    return async (anchor): Promise<AnchorReconciliation> => {
      // Every scope but `rendered` carries its stored anchor unchanged; only its drift
      // flag is recomputed.
      const carried = (drifted: boolean): AnchorReconciliation => ({
        anchor,
        drifted,
      });

      if (anchor.scope === "review") {
        return carried(false);
      }

      const changedFile = changedByPath.get(anchor.path);
      if (!changedFile) {
        return carried(true);
      }

      if (anchor.scope === "file" && !("locator" in anchor)) {
        return carried(false);
      }

      if (changedFile.status === "removed") {
        return carried(true);
      }

      if (anchor.scope === "range") {
        const lines = addressableHeadLines(await headText(anchor.path));
        return carried(
          lines.slice(anchor.startLine - 1, anchor.endLine).join("\n") !==
            anchor.quote,
        );
      }

      if (anchor.scope === "line") {
        const lines = addressableHeadLines(await headText(anchor.path));
        return carried(lines[anchor.line - 1] !== anchor.quote);
      }

      // A rendered-text anchor is reattached through the pure #68 decision against the
      // review-text reproduced from the new head (a Mirror, the sanitized HTML copy, or a
      // rendered Canonical). The exact quote plus prefix/suffix context decide; the stored
      // start/end are hints only. When the decision singles out one safe location the span
      // is recomputed (unmoved or moved) and the comment carries not-drifted; otherwise the
      // stored selector is preserved unchanged and the comment drifts - a valid-but-wrong
      // position never overrides a quote mismatch (#69, replacing the #63-era detection-only
      // deferral).
      if (anchor.scope === "rendered") {
        const reviewText = await renderedReviewText(anchor.path, anchor.format);
        const decision = decideRenderedTextReattachment(anchor, reviewText);
        if (decision.outcome === "reattached") {
          return {
            anchor: { ...anchor, start: decision.start, end: decision.end },
            drifted: false,
          };
        }
        return carried(true);
      }

      const text = await canonicalText(anchor.path);
      return carried(
        !text.includes(anchor.locator.section) ||
          !text.includes(anchor.locator.quote),
      );
    };
  }

  private async validateAnchor(
    slug: string,
    headSha: string,
    changedFiles: ChangedFile[],
    anchor: FeedbackAnchor,
  ): Promise<void> {
    if (anchor.scope === "review") {
      return;
    }

    if (!changedFiles.some((file) => file.path === anchor.path)) {
      throw new BadRequestException("Feedback path is not a changed document");
    }

    const lowerPath = anchor.path.toLowerCase();

    if (anchor.scope === "range") {
      if (!lowerPath.endsWith(".md")) {
        throw new BadRequestException("Range feedback requires a Mirror");
      }
      const blob = await this.source.fetchBlob(slug, headSha, anchor.path);
      const lines = addressableHeadLines(blob.bytes.toString("utf8"));
      if (anchor.endLine > lines.length) {
        throw new BadRequestException("Mirror range is outside the PR head");
      }
      const addressed = lines
        .slice(anchor.startLine - 1, anchor.endLine)
        .join("\n");
      if (addressed !== anchor.quote) {
        throw new BadRequestException(
          "Mirror quote must match the addressed head lines exactly",
        );
      }
      return;
    }

    if (anchor.scope === "rendered") {
      // The wire contract already bound `format` to `path` (a Mirror `.md`, an HTML
      // `.html`/`.htm`, or a Canonical `.docx`), so a mismatched selector/path never
      // reaches here. A deleted document has no head to reproduce a review-text from, so
      // it can never address a rendered quote.
      const changedFile = changedFiles.find(
        (file) => file.path === anchor.path,
      );
      if (changedFile?.status === "removed") {
        throw new BadRequestException(
          "Rendered-text feedback requires a live document head",
        );
      }
      const blob = await this.source.fetchBlob(slug, headSha, anchor.path);
      const reviewText = await reproduceRenderedReviewText(
        anchor.format,
        blob.bytes,
      );
      if (anchor.end > reviewText.length) {
        throw new BadRequestException(
          "Rendered-text range is outside the PR head",
        );
      }
      // Position hints are hints only: the quote and its immediate prefix/suffix
      // context must appear at them in the authoritative review-text, or the anchor
      // is rejected (a hint never overrides a selector mismatch).
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
      return;
    }

    if (anchor.scope === "line") {
      if (!/\.html?$/.test(lowerPath)) {
        throw new BadRequestException("Line feedback requires HTML source");
      }
      const blob = await this.source.fetchBlob(slug, headSha, anchor.path);
      const addressed = addressableHeadLines(blob.bytes.toString("utf8"))[
        anchor.line - 1
      ];
      if (addressed !== anchor.quote) {
        throw new BadRequestException(
          "HTML quote must match the addressed head line exactly",
        );
      }
      return;
    }

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

  // Streams a changed file's raw HEAD bytes for the blob-serving route. Read-only:
  // HTML can pin the ref that produced its review surface, while other callers resolve
  // the live PR head from metadata. Both paths fetch through the same GitHubSource seam
  // and receive an extension-derived content type. The controller layers the HTML
  // browsing policy on this exact-byte transport.
  async getRawFile(
    owner: string,
    repo: string,
    prNumber: number,
    path: string,
    pinnedRef?: string,
  ): Promise<RawFile> {
    const { slug, reviewKey, meta } =
      await this.loadOpenPullRequestWithMergeCleanup(owner, repo, prNumber);
    if (
      pinnedRef !== undefined &&
      !(await this.reviewState.hasReviewHead(reviewKey, pinnedRef))
    ) {
      throw new BadRequestException(
        "Raw file ref must belong to this pull request's review history",
      );
    }
    const blob = await this.source.fetchBlob(
      slug,
      pinnedRef ?? meta.headSha,
      path,
    );
    const { contentType, inline } = transportFor(path);

    return {
      bytes: blob.bytes,
      contentType,
      filename: path.slice(path.lastIndexOf("/") + 1),
      inline,
    };
  }
}
