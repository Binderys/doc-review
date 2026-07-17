import type {
  FeedbackAnchor,
  ReviewSurfaceResponse,
} from "@doc-review/api-contracts";
import { useEffect } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reviewSurfaceApi } from "../shared/api";
import { ReviewSurfacePage } from "./ReviewSurfacePage";

const fixture: ReviewSurfaceResponse = {
  number: 38,
  title: "Durable feedback",
  description: "Separates feedback writes from refreshes.",
  sourceBranchUrl: "https://github.com/acme/doc-review/tree/feedback",
  githubUrl: "https://github.com/acme/doc-review/pull/38",
  currentRound: {
    number: 1,
    headSha: "1234567890abcdef",
    createdAt: "2026-07-13T00:00:00.000Z",
    status: "open",
    comments: [],
  },
  rounds: [
    {
      number: 1,
      headSha: "1234567890abcdef",
      createdAt: "2026-07-13T00:00:00.000Z",
      status: "open",
      comments: [],
    },
  ],
  files: [],
};

let submitFeedback: ((anchor: FeedbackAnchor) => Promise<void>) | undefined;
const setFeedbackError = vi.fn();

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  let stateCall = 0;

  return {
    ...actual,
    useEffect: vi.fn(),
    // The page calls useState three times per render (data, error, feedbackError).
    // Reset after the third so every render - not just the first - sees the loaded
    // surface and the tracked feedback-error setter, independent of test order.
    useState: vi.fn(() => {
      stateCall += 1;
      const result =
        stateCall === 1
          ? [fixture, vi.fn()]
          : stateCall === 3
            ? [null, setFeedbackError]
            : [null, vi.fn()];
      if (stateCall >= 3) stateCall = 0;
      return result;
    }),
  };
});

vi.mock("./ReviewSurfaceView", () => ({
  ReviewSurfaceView: ({
    onSubmitFeedback,
  }: {
    onSubmitFeedback: (anchor: FeedbackAnchor) => Promise<void>;
  }) => {
    submitFeedback = onSubmitFeedback;
    return null;
  },
}));

describe("ReviewSurfacePage", () => {
  beforeEach(() => {
    submitFeedback = undefined;
    setFeedbackError.mockClear();
    vi.restoreAllMocks();
    vi.stubGlobal("window", {
      location: { pathname: "/pr/acme/doc-review/38" },
    });
  });

  it("reports saved feedback separately when the post-submit refresh fails", async () => {
    vi.spyOn(reviewSurfaceApi, "createFeedback").mockResolvedValue({
      scope: "review",
      body: "Ship it",
      id: "comment-1",
      headSha: fixture.currentRound.headSha,
      roundNumber: 1,
      createdAt: "2026-07-13T00:01:00.000Z",
      resolved: false,
      carriedForward: false,
      drifted: false,
    });
    vi.spyOn(reviewSurfaceApi, "getReviewSurface").mockRejectedValue(
      new Error("Transient refresh failure"),
    );

    renderToStaticMarkup(<ReviewSurfacePage />);
    expect(submitFeedback).toBeDefined();

    await submitFeedback?.({ scope: "review", body: "Ship it" });

    expect(reviewSurfaceApi.createFeedback).toHaveBeenCalledOnce();
    expect(reviewSurfaceApi.getReviewSurface).toHaveBeenCalledOnce();
    expect(setFeedbackError).toHaveBeenLastCalledWith(
      "Feedback saved, but the surface could not be refreshed. Reload to see it.",
    );
  });

  it("submits a rendered-text anchor through the local feedback API, then refreshes", async () => {
    const anchor: FeedbackAnchor = {
      scope: "rendered",
      format: "md",
      path: "deliverables/memo.md",
      quote: "Bandersnatch metric holds firm",
      prefix: "The ",
      suffix: " across revisions",
      start: 4,
      end: 34,
      selectorVersion: 1,
      body: "Anchor this to the rendered text.",
    };
    vi.spyOn(reviewSurfaceApi, "createFeedback").mockResolvedValue({
      ...anchor,
      id: "comment-rendered",
      headSha: fixture.currentRound.headSha,
      roundNumber: 1,
      createdAt: "2026-07-13T00:01:00.000Z",
      resolved: false,
      carriedForward: false,
      drifted: false,
    });
    const refresh = vi
      .spyOn(reviewSurfaceApi, "getReviewSurface")
      .mockResolvedValue(fixture);

    renderToStaticMarkup(<ReviewSurfacePage />);
    expect(submitFeedback).toBeDefined();

    await submitFeedback?.(anchor);

    // Only the existing local feedback endpoint is called, then the durable surface
    // is re-read - no rendered-annotation-specific write path.
    expect(reviewSurfaceApi.createFeedback).toHaveBeenCalledWith(
      "acme",
      "doc-review",
      38,
      anchor,
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("submits an HTML rendered-text anchor through the same local feedback API, then refreshes", async () => {
    // The sanitized HTML copy joins the SAME durable feedback lifecycle: an HTML-path
    // rendered anchor flows through the shared local endpoint, not a format-specific one.
    const anchor: FeedbackAnchor = {
      scope: "rendered",
      format: "html",
      path: "sources/report.html",
      quote: "The Bandersnatch metric holds firm across revisions.",
      prefix: "Intro paragraph about scope.\n",
      suffix: "\nClosing note.",
      start: 35,
      end: 87,
      selectorVersion: 1,
      body: "Anchor this HTML sentence.",
    };
    vi.spyOn(reviewSurfaceApi, "createFeedback").mockResolvedValue({
      ...anchor,
      id: "comment-html-rendered",
      headSha: fixture.currentRound.headSha,
      roundNumber: 1,
      createdAt: "2026-07-13T00:01:00.000Z",
      resolved: false,
      carriedForward: false,
      drifted: false,
    });
    const refresh = vi
      .spyOn(reviewSurfaceApi, "getReviewSurface")
      .mockResolvedValue(fixture);

    renderToStaticMarkup(<ReviewSurfacePage />);
    expect(submitFeedback).toBeDefined();

    await submitFeedback?.(anchor);

    expect(reviewSurfaceApi.createFeedback).toHaveBeenCalledWith(
      "acme",
      "doc-review",
      38,
      anchor,
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("submits a Canonical rendered-text anchor through the same local feedback API, then refreshes", async () => {
    // The rendered Canonical joins the SAME durable feedback lifecycle: a docx-path
    // rendered anchor flows through the shared local endpoint, not a format-specific one.
    const anchor: FeedbackAnchor = {
      scope: "rendered",
      format: "docx",
      path: "deliverables/memo.docx",
      quote: "The Bandersnatch metric holds firm across revisions.",
      prefix: "Zephyr canonical overview.\n",
      suffix: "\nAlpha canonical cell.",
      start: 27,
      end: 79,
      selectorVersion: 1,
      body: "Anchor this Canonical sentence.",
    };
    vi.spyOn(reviewSurfaceApi, "createFeedback").mockResolvedValue({
      ...anchor,
      id: "comment-docx-rendered",
      headSha: fixture.currentRound.headSha,
      roundNumber: 1,
      createdAt: "2026-07-15T00:01:00.000Z",
      resolved: false,
      carriedForward: false,
      drifted: false,
    });
    const refresh = vi
      .spyOn(reviewSurfaceApi, "getReviewSurface")
      .mockResolvedValue(fixture);

    renderToStaticMarkup(<ReviewSurfacePage />);
    expect(submitFeedback).toBeDefined();

    await submitFeedback?.(anchor);

    expect(reviewSurfaceApi.createFeedback).toHaveBeenCalledWith(
      "acme",
      "doc-review",
      38,
      anchor,
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("reconciles the lifecycle before reading the review surface", async () => {
    const calls: string[] = [];
    vi.spyOn(reviewSurfaceApi, "reconcileReview").mockImplementation(
      async () => {
        calls.push("reconcile");
        return fixture.currentRound;
      },
    );
    vi.spyOn(reviewSurfaceApi, "getReviewSurface").mockImplementation(
      async () => {
        calls.push("get");
        return fixture;
      },
    );

    renderToStaticMarkup(<ReviewSurfacePage />);
    const effect = vi.mocked(useEffect).mock.calls.at(-1)?.[0];
    expect(effect).toBeDefined();
    const cleanup = effect?.();

    await vi.waitFor(() => expect(calls).toEqual(["reconcile", "get"]));
    if (typeof cleanup === "function") {
      cleanup();
    }
  });
});
