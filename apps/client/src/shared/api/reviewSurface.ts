import {
  reviewArtifactSchema,
  reviewCommentSchema,
  reviewRoundSchema,
  reviewSurfaceResponseSchema,
  type FeedbackAnchor,
  type ReviewArtifact,
  type ReviewComment,
  type ReviewRound,
  type ReviewSurfaceResponse,
} from "@doc-review/api-contracts";
import { apiClient, type ApiClient } from "./apiClient";

// Thin, typed domain API over explicit lifecycle reconciliation, review-surface reads,
// local-feedback writes, and reviewer-driven round transitions. Each call parses its
// response against the contract schema at the boundary.
export type ReviewSurfaceApi = {
  reconcileReview(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<ReviewRound>;
  getReviewSurface(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<ReviewSurfaceResponse>;
  createFeedback(
    owner: string,
    repo: string,
    prNumber: number,
    anchor: FeedbackAnchor,
  ): Promise<ReviewComment>;
  finishRound(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<ReviewArtifact>;
  resolveComment(
    owner: string,
    repo: string,
    prNumber: number,
    commentId: string,
  ): Promise<ReviewComment>;
  approveRound(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<ReviewArtifact>;
  getCurrentArtifact(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<ReviewArtifact>;
};

const encode = (segment: string): string => encodeURIComponent(segment);

const reviewPath = (owner: string, repo: string, prNumber: number): string =>
  `/pr/${encode(owner)}/${encode(repo)}/${prNumber}`;

export const createReviewSurfaceApi = (
  client: ApiClient,
): ReviewSurfaceApi => ({
  reconcileReview: (owner, repo, prNumber) =>
    client.post(
      `${reviewPath(owner, repo, prNumber)}/review/reconcile`,
      undefined,
      { schema: reviewRoundSchema },
    ),
  getReviewSurface: (owner, repo, prNumber) =>
    client.get(reviewPath(owner, repo, prNumber), {
      schema: reviewSurfaceResponseSchema,
    }),
  createFeedback: (owner, repo, prNumber, anchor) =>
    client.post(`${reviewPath(owner, repo, prNumber)}/comments`, anchor, {
      schema: reviewCommentSchema,
    }),
  // The transitions PATCH the round resource (`review/current`) or the comment; the
  // frozen round's artifact (or the updated comment) is the response.
  finishRound: (owner, repo, prNumber) =>
    client.patch(
      `${reviewPath(owner, repo, prNumber)}/review/current`,
      { status: "finished" },
      { schema: reviewArtifactSchema },
    ),
  resolveComment: (owner, repo, prNumber, commentId) =>
    client.patch(
      `${reviewPath(owner, repo, prNumber)}/comments/${encode(commentId)}`,
      { resolved: true },
      { schema: reviewCommentSchema },
    ),
  approveRound: (owner, repo, prNumber) =>
    client.patch(
      `${reviewPath(owner, repo, prNumber)}/review/current`,
      { status: "approved" },
      { schema: reviewArtifactSchema },
    ),
  getCurrentArtifact: (owner, repo, prNumber) =>
    client.get(`${reviewPath(owner, repo, prNumber)}/review/current`, {
      schema: reviewArtifactSchema,
    }),
});

export const reviewSurfaceApi = createReviewSurfaceApi(apiClient);
