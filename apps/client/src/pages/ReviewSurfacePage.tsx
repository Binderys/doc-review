import type {
  FeedbackAnchor,
  ReviewSurfaceResponse,
} from "@doc-review/api-contracts";
import { useEffect, useState } from "react";
import { reviewSurfaceApi } from "../shared/api";
import { ReviewSurfaceView } from "./ReviewSurfaceView";

// Parses `/pr/:owner/:repo/:number` from a path. Returns null when the shape does
// not match, so the page can surface a clear error rather than fetch a bad route.
function parseReviewRoute(
  pathname: string,
): { owner: string; repo: string; number: number } | null {
  const match = /^\/pr\/([^/]+)\/([^/]+)\/(\d+)$/.exec(pathname);
  if (!match) return null;
  return {
    owner: decodeURIComponent(match[1]),
    repo: decodeURIComponent(match[2]),
    number: Number(match[3]),
  };
}

// Review-surface page: parses the route, explicitly reconciles the durable lifecycle,
// then reads the surface and hands it to the presentational view. Reconciled per mount,
// so a reload reflects the PR's live exact head without hiding a write in GET.
export function ReviewSurfacePage() {
  const [data, setData] = useState<ReviewSurfaceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  useEffect(() => {
    const route = parseReviewRoute(window.location.pathname);
    if (!route) {
      setError("Not a review-surface route.");
      return;
    }

    let active = true;

    reviewSurfaceApi
      .reconcileReview(route.owner, route.repo, route.number)
      .then(() =>
        reviewSurfaceApi.getReviewSurface(
          route.owner,
          route.repo,
          route.number,
        ),
      )
      .then((result) => {
        if (active) setData(result);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Failed to load review surface",
          );
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const submitFeedback = async (anchor: FeedbackAnchor): Promise<void> => {
    const route = parseReviewRoute(window.location.pathname);
    if (!route) {
      setFeedbackError("Not a review-surface route.");
      return;
    }

    try {
      await reviewSurfaceApi.createFeedback(
        route.owner,
        route.repo,
        route.number,
        anchor,
      );
    } catch (cause: unknown) {
      setFeedbackError(
        cause instanceof Error ? cause.message : "Failed to add feedback",
      );
      return;
    }

    // The feedback is durably persisted at this point; a failed refresh must not
    // be reported as a write failure (a retry would create a duplicate comment).
    setFeedbackError(null);
    try {
      const refreshed = await reviewSurfaceApi.getReviewSurface(
        route.owner,
        route.repo,
        route.number,
      );
      setData(refreshed);
    } catch {
      setFeedbackError(
        "Feedback saved, but the surface could not be refreshed. Reload to see it.",
      );
    }
  };

  // Drives a reviewer-driven round transition (#39): run the transition, then refresh
  // the surface. Like feedback, a durable transition must not be reported as a write
  // failure just because the follow-up read fails.
  const runRoundAction = async (
    action: (route: {
      owner: string;
      repo: string;
      number: number;
    }) => Promise<unknown>,
  ): Promise<void> => {
    const route = parseReviewRoute(window.location.pathname);
    if (!route) {
      setFeedbackError("Not a review-surface route.");
      return;
    }

    try {
      await action(route);
    } catch (cause: unknown) {
      setFeedbackError(
        cause instanceof Error ? cause.message : "Round action failed",
      );
      return;
    }

    setFeedbackError(null);
    try {
      const refreshed = await reviewSurfaceApi.getReviewSurface(
        route.owner,
        route.repo,
        route.number,
      );
      setData(refreshed);
    } catch {
      setFeedbackError(
        "Action saved, but the surface could not be refreshed. Reload to see it.",
      );
    }
  };

  return (
    <section
      className="app-shell__inner app-shell__inner--review"
      aria-label="Document review"
    >
      {error ? (
        <p className="app-shell__error" role="alert">
          {error}
        </p>
      ) : data ? (
        <>
          {feedbackError ? (
            <p className="app-shell__error" role="alert">
              {feedbackError}
            </p>
          ) : null}
          <ReviewSurfaceView
            {...data}
            onSubmitFeedback={submitFeedback}
            onFinish={() =>
              runRoundAction((route) =>
                reviewSurfaceApi.finishRound(
                  route.owner,
                  route.repo,
                  route.number,
                ),
              )
            }
            onResolve={(commentId) =>
              runRoundAction((route) =>
                reviewSurfaceApi.resolveComment(
                  route.owner,
                  route.repo,
                  route.number,
                  commentId,
                ),
              )
            }
            onApprove={() =>
              runRoundAction((route) =>
                reviewSurfaceApi.approveRound(
                  route.owner,
                  route.repo,
                  route.number,
                ),
              )
            }
          />
        </>
      ) : (
        <p className="app-shell__loading">Loading review surface...</p>
      )}
    </section>
  );
}
