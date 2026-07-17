import {
  renderedPathMatchesFormat,
  renderedTextFormatSchema,
  z,
} from "@doc-review/api-contracts";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const storedBodySchema = z.string().min(1);
const storedPathSchema = z.string().min(1);
const storedMirrorPathSchema = storedPathSchema.refine((path) =>
  path.toLowerCase().endsWith(".md"),
);
const storedCanonicalPathSchema = storedPathSchema.refine((path) =>
  path.toLowerCase().endsWith(".docx"),
);
const storedPdfPathSchema = storedPathSchema.refine((path) =>
  path.toLowerCase().endsWith(".pdf"),
);
const storedHtmlPathSchema = storedPathSchema.refine((path) =>
  /\.html?$/.test(path.toLowerCase()),
);
const storedFeedbackAnchorSchema = z.union([
  z
    .object({
      scope: z.literal("range"),
      path: storedMirrorPathSchema,
      startLine: z.number().int().positive(),
      endLine: z.number().int().positive(),
      quote: z.string(),
      body: storedBodySchema,
    })
    .strict()
    .refine((anchor) => anchor.endLine >= anchor.startLine),
  z
    .object({
      scope: z.literal("rendered"),
      // The rendered format (a Mirror #63 or the sanitized HTML copy #66), bound to the
      // path by the shared contract predicate so a persisted selector's format provenance
      // survives a restart and is never inferred from the extension alone. Defaults to
      // "md" so rendered anchors persisted before #66 (all Mirrors, no format field) still
      // parse - one un-migratable anchor must not poison the whole review-state file. The
      // path refine still validates the defaulted value (a pre-#66 Mirror anchor is .md).
      format: renderedTextFormatSchema.default("md"),
      path: storedPathSchema,
      quote: z.string().min(1),
      prefix: z.string(),
      suffix: z.string(),
      start: z.number().int().nonnegative(),
      end: z.number().int().positive(),
      selectorVersion: z.literal(1),
      body: storedBodySchema,
    })
    .strict()
    .refine((anchor) => anchor.end > anchor.start)
    .refine((anchor) => renderedPathMatchesFormat(anchor.format, anchor.path)),
  z
    .object({
      scope: z.literal("file"),
      path: storedCanonicalPathSchema,
      locator: z
        .object({ section: z.string().min(1), quote: z.string().min(1) })
        .strict(),
      body: storedBodySchema,
    })
    .strict(),
  z
    .object({
      scope: z.literal("file"),
      path: storedPdfPathSchema,
      body: storedBodySchema,
    })
    .strict(),
  z
    .object({
      scope: z.literal("line"),
      path: storedHtmlPathSchema,
      line: z.number().int().positive(),
      quote: z.string(),
      body: storedBodySchema,
    })
    .strict(),
  z.object({ scope: z.literal("review"), body: storedBodySchema }).strict(),
]);

const storedReviewCommentSchema = z
  .object({
    id: z.string().min(1),
    headSha: z.string().min(1),
    roundNumber: z.number().int().positive(),
    createdAt: z.string().datetime(),
    // `resolved` defaults to false so state persisted before #39 (no flag) still
    // parses; new comments are always created unresolved.
    resolved: z.boolean().default(false),
    // These defaults keep state written before #40 readable. Fresh comments are
    // neither carried nor drifted; copies made for a later exact head set both
    // fields explicitly.
    carriedForward: z.boolean().default(false),
    drifted: z.boolean().default(false),
    anchor: storedFeedbackAnchorSchema,
  })
  .strict();

// The round lifecycle (#39). `status` defaults to "open" so state persisted before
// #39 (no status) still parses as an open round.
const storedRoundStatusSchema = z.enum(["open", "finished", "approved"]);

const storedReviewRoundSchema = z
  .object({
    number: z.number().int().positive(),
    headSha: z.string().min(1),
    createdAt: z.string().datetime(),
    status: storedRoundStatusSchema.default("open"),
    comments: z.array(storedReviewCommentSchema),
  })
  .strict();

const persistedReviewStateSchema = z
  .object({
    reviews: z.record(z.string(), z.array(storedReviewRoundSchema)),
  })
  .strict();

export type ReviewAnchorState = z.infer<typeof storedFeedbackAnchorSchema>;
export type ReviewCommentState = z.infer<typeof storedReviewCommentSchema>;
export type ReviewRoundState = z.infer<typeof storedReviewRoundSchema>;
type PersistedReviewState = z.infer<typeof persistedReviewStateSchema>;

export type ReviewRoundsState = {
  currentRound: ReviewRoundState;
  rounds: ReviewRoundState[];
};

// The reconciliation of one carried anchor against a new exact head: the anchor as it
// must persist on the new round, plus the server-owned drift result. A rendered anchor
// may carry a RECOMPUTED span when its exact quote reattaches at a moved position (#69);
// every other scope (and a drifted rendered anchor) carries its stored anchor unchanged,
// so a valid-but-wrong position never overrides a quote mismatch in durable state.
export type AnchorReconciliation = {
  anchor: ReviewAnchorState;
  drifted: boolean;
};
export type ReconcileAnchor = (
  anchor: ReviewAnchorState,
) => Promise<AnchorReconciliation>;

// Discriminated results the store returns for each guarded transition. The store
// stays framework-free (no HTTP exceptions); the service maps these to Nest's
// ConflictException/NotFoundException.
export type AddCommentResult =
  { outcome: "added"; comment: ReviewCommentState } | { outcome: "not-open" };

export type FinishRoundResult =
  { outcome: "finished"; round: ReviewRoundState } | { outcome: "not-open" };

export type ResolveCommentResult =
  | { outcome: "resolved"; comment: ReviewCommentState }
  | { outcome: "not-open" }
  | { outcome: "no-comment" };

export type ApproveRoundResult =
  | { outcome: "approved"; round: ReviewRoundState }
  | { outcome: "not-open" }
  | { outcome: "unresolved" };

export type ArtifactRoundResult =
  | { outcome: "available"; round: ReviewRoundState }
  | { outcome: "unavailable" };

@Injectable()
export class ReviewStateStore {
  private readonly statePath: string;
  private pendingOperation: Promise<void> = Promise.resolve();

  constructor(config: ConfigService) {
    this.statePath = resolve(
      config.get<string>("reviewStatePath") ?? ".data/review-state.json",
    );
  }

  reconcileRound(
    reviewKey: string,
    headSha: string,
    reconcileAnchor: ReconcileAnchor,
  ): Promise<ReviewRoundsState> {
    return this.runExclusive(async () => {
      const state = await this.readState();
      const rounds = state.reviews[reviewKey] ?? [];
      const currentRound = rounds.at(-1);
      if (currentRound?.headSha === headSha) {
        return { currentRound, rounds };
      }

      const number = rounds.length + 1;
      const previousComments =
        rounds.at(-1)?.comments.filter((comment) => !comment.resolved) ?? [];
      const comments = await Promise.all(
        previousComments.map(async (comment): Promise<ReviewCommentState> => {
          const { anchor, drifted } = await reconcileAnchor(comment.anchor);
          return {
            ...comment,
            anchor,
            headSha,
            roundNumber: number,
            resolved: false,
            carriedForward: true,
            drifted,
          };
        }),
      );
      const round: ReviewRoundState = {
        number,
        headSha,
        createdAt: new Date().toISOString(),
        status: "open",
        comments,
      };
      rounds.push(round);
      state.reviews[reviewKey] = rounds;
      await this.writeState(state);

      return {
        currentRound: round,
        rounds,
      };
    });
  }

  getCurrentRound(
    reviewKey: string,
    headSha: string,
  ): Promise<ReviewRoundsState | undefined> {
    return this.runExclusive(async () => {
      const state = await this.readState();
      const rounds = state.reviews[reviewKey] ?? [];
      const currentRound = rounds.at(-1);
      if (currentRound?.headSha !== headSha) {
        return undefined;
      }
      return { currentRound, rounds };
    });
  }

  hasReviewHead(reviewKey: string, headSha: string): Promise<boolean> {
    return this.runExclusive(async () => {
      const state = await this.readState();
      return (state.reviews[reviewKey] ?? []).some(
        (round) => round.headSha === headSha,
      );
    });
  }

  deleteReview(reviewKey: string): Promise<void> {
    return this.runExclusive(async () => {
      const state = await this.readState();
      if (!(reviewKey in state.reviews)) {
        return;
      }
      delete state.reviews[reviewKey];
      await this.writeState(state);
    });
  }

  addComment(
    reviewKey: string,
    headSha: string,
    anchor: ReviewAnchorState,
  ): Promise<AddCommentResult> {
    return this.runExclusive(async () => {
      const state = await this.readState();
      const round = this.findRound(state, reviewKey, headSha);
      // A frozen (finished/approved) round rejects new comments; a new exact head
      // owns a separate open round.
      if (round.status !== "open") {
        return { outcome: "not-open" };
      }
      const comment: ReviewCommentState = {
        id: randomUUID(),
        headSha,
        roundNumber: round.number,
        createdAt: new Date().toISOString(),
        resolved: false,
        carriedForward: false,
        drifted: false,
        anchor,
      };

      round.comments.push(comment);
      await this.writeState(state);
      return { outcome: "added", comment };
    });
  }

  // Freezes the current open round. Finishing never resolves a comment.
  finishRound(reviewKey: string, headSha: string): Promise<FinishRoundResult> {
    return this.runExclusive(async () => {
      const state = await this.readState();
      const round = this.findRound(state, reviewKey, headSha);
      if (round.status !== "open") {
        return { outcome: "not-open" };
      }
      round.status = "finished";
      await this.writeState(state);
      return { outcome: "finished", round };
    });
  }

  // Resolves one comment, only while the round is open. A missing comment id is a
  // no-comment result; a frozen round rejects resolution outright.
  resolveComment(
    reviewKey: string,
    headSha: string,
    commentId: string,
  ): Promise<ResolveCommentResult> {
    return this.runExclusive(async () => {
      const state = await this.readState();
      const round = this.findRound(state, reviewKey, headSha);
      if (round.status !== "open") {
        return { outcome: "not-open" };
      }
      const comment = round.comments.find((entry) => entry.id === commentId);
      if (!comment) {
        return { outcome: "no-comment" };
      }
      comment.resolved = true;
      await this.writeState(state);
      return { outcome: "resolved", comment };
    });
  }

  // Approves the current open round, but only with zero unresolved comments. An
  // alternative exit from open; not reachable from a finished round.
  approveRound(
    reviewKey: string,
    headSha: string,
  ): Promise<ApproveRoundResult> {
    return this.runExclusive(async () => {
      const state = await this.readState();
      const round = this.findRound(state, reviewKey, headSha);
      if (round.status !== "open") {
        return { outcome: "not-open" };
      }
      if (round.comments.some((comment) => !comment.resolved)) {
        return { outcome: "unresolved" };
      }
      round.status = "approved";
      await this.writeState(state);
      return { outcome: "approved", round };
    });
  }

  // Read-only lookup for the finish artifact: available only once the round for this
  // exact head is finished or approved. An open (or absent) round is unavailable, so
  // the artifact is never exposed before the reviewer freezes the round.
  getRoundForArtifact(
    reviewKey: string,
    headSha: string,
  ): Promise<ArtifactRoundResult> {
    return this.runExclusive(async () => {
      const state = await this.readState();
      const rounds = state.reviews[reviewKey] ?? [];
      const round = rounds.at(-1);
      if (!round || round.status === "open") {
        return { outcome: "unavailable" };
      }
      if (round.headSha !== headSha) {
        return { outcome: "unavailable" };
      }
      return { outcome: "available", round };
    });
  }

  private findRound(
    state: PersistedReviewState,
    reviewKey: string,
    headSha: string,
  ): ReviewRoundState {
    const rounds = state.reviews[reviewKey] ?? [];
    const round = rounds.at(-1);
    if (!round || round.headSha !== headSha) {
      throw new Error(
        `Review round ${reviewKey}@${headSha} was not initialized before mutation`,
      );
    }
    return round;
  }

  private runExclusive<Result>(work: () => Promise<Result>): Promise<Result> {
    const result = this.pendingOperation.then(work);
    this.pendingOperation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async readState(): Promise<PersistedReviewState> {
    try {
      const raw = await readFile(this.statePath, "utf8");
      return persistedReviewStateSchema.parse(JSON.parse(raw) as unknown);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return { reviews: {} };
      }
      throw error;
    }
  }

  private async writeState(state: PersistedReviewState): Promise<void> {
    await mkdir(dirname(this.statePath), { recursive: true });
    const temporaryPath = `${this.statePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(state, null, 2), "utf8");
    await rename(temporaryPath, this.statePath);
  }
}
