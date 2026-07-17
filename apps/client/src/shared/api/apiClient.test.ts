import {
  healthResponseSchema,
  z,
  type FeedbackAnchor,
} from "@doc-review/api-contracts";
import { describe, expect, it, vi } from "vitest";
import {
  ApiClientError,
  createApiClient,
  createHealthApi,
  createReviewSurfaceApi,
  resolveApiResourceUrl,
} from "./index";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("createApiClient", () => {
  it("resolves server resource paths against the configured API origin", () => {
    expect(
      resolveApiResourceUrl(
        "/pr/acme/reports/78/raw?path=report.html&ref=7878787878787878787878787878787878787878",
        "http://api.test:3000/",
      ),
    ).toBe(
      "http://api.test:3000/pr/acme/reports/78/raw?path=report.html&ref=7878787878787878787878787878787878787878",
    );
  });

  it("prefixes the base URL and returns the parsed data of a valid envelope", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ success: true, data: { status: "ok" } }),
    );
    const client = createApiClient({ baseUrl: "http://api.test", fetcher });

    await expect(
      client.get("/health", { schema: healthResponseSchema }),
    ).resolves.toEqual({ status: "ok" });
    expect(fetcher).toHaveBeenCalledWith(
      "http://api.test/health",
      expect.objectContaining({ method: "GET" }),
    );
  });

  // Planted-failure proof: an ok response whose body does not match the contract
  // is surfaced as an error rather than trusted. Remove the envelope safeParse in
  // apiClient.ts and this test fails.
  it("throws when an ok response does not match the contract schema", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ success: true, data: { status: "degraded" } }),
    );
    const client = createApiClient({ baseUrl: "http://api.test", fetcher });

    await expect(
      client.get("/health", { schema: healthResponseSchema }),
    ).rejects.toMatchObject({
      name: "ApiClientError",
      message: "Invalid API response",
      statusCode: 200,
    });
  });

  it("surfaces the message and status code of a contract error envelope", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse(
        { success: false, statusCode: 401, message: "Unauthorized" },
        401,
      ),
    );
    const client = createApiClient({ baseUrl: "http://api.test/", fetcher });

    await expect(
      client.get("/users", { schema: z.array(z.unknown()) }),
    ).rejects.toMatchObject({ message: "Unauthorized", statusCode: 401 });
  });

  it("falls back to the transport status when an error body is not a contract error", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response("<html>Bad Gateway</html>", {
          status: 502,
          statusText: "Bad Gateway",
          headers: { "Content-Type": "text/html" },
        }),
    );
    const client = createApiClient({ baseUrl: "http://api.test", fetcher });

    await expect(
      client.get("/health", { schema: healthResponseSchema }),
    ).rejects.toMatchObject({ message: "Bad Gateway", statusCode: 502 });
  });

  it("sends JSON bodies for post and parses the envelope", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ success: true, data: { id: "1" } }, 201),
    );
    const client = createApiClient({ baseUrl: "http://api.test", fetcher });

    await expect(
      client.post(
        "/things",
        { name: "widget" },
        { schema: z.object({ id: z.string() }) },
      ),
    ).resolves.toEqual({ id: "1" });
    expect(fetcher).toHaveBeenCalledWith(
      "http://api.test/things",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "widget" }),
      }),
    );
  });

  it("issues delete requests and parses the envelope", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ success: true, data: { deleted: true } }),
    );
    const client = createApiClient({ baseUrl: "http://api.test", fetcher });

    await expect(
      client.delete("/things/1", {
        schema: z.object({ deleted: z.boolean() }),
      }),
    ).resolves.toEqual({ deleted: true });
    expect(fetcher).toHaveBeenCalledWith(
      "http://api.test/things/1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("exposes ApiClientError as the thrown error type", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ success: true, data: { status: "nope" } }),
    );
    const client = createApiClient({ baseUrl: "http://api.test", fetcher });

    await expect(
      client.get("/health", { schema: healthResponseSchema }),
    ).rejects.toBeInstanceOf(ApiClientError);
  });
});

describe("createHealthApi", () => {
  it("fetches and parses the health endpoint through a typed domain API", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ success: true, data: { status: "ok" } }),
    );
    const health = createHealthApi(
      createApiClient({ baseUrl: "http://api.test", fetcher }),
    );

    await expect(health.getHealth()).resolves.toEqual({ status: "ok" });
    expect(fetcher).toHaveBeenCalledWith(
      "http://api.test/health",
      expect.objectContaining({ method: "GET" }),
    );
  });
});

describe("createReviewSurfaceApi", () => {
  it("reconciles the durable review lifecycle through an explicit POST", async () => {
    const round = {
      number: 2,
      headSha: "1234567890abcdef",
      createdAt: "2026-07-14T00:00:00.000Z",
      status: "open" as const,
      comments: [],
    };
    const fetcher = vi.fn(async () =>
      jsonResponse({ success: true, data: round }, 200),
    );
    const reviewSurface = createReviewSurfaceApi(
      createApiClient({ baseUrl: "http://api.test", fetcher }),
    );

    await expect(
      reviewSurface.reconcileReview("owner name", "repo/name", 38),
    ).resolves.toEqual(round);
    expect(fetcher).toHaveBeenCalledWith(
      "http://api.test/pr/owner%20name/repo%2Fname/38/review/reconcile",
      expect.objectContaining({ method: "POST", body: undefined }),
    );
  });

  const anchors: FeedbackAnchor[] = [
    {
      scope: "range",
      path: "deliverables/memo.md",
      startLine: 2,
      endLine: 3,
      quote: "Exact range",
      body: "Mirror feedback",
    },
    {
      scope: "file",
      path: "deliverables/memo.docx",
      locator: { section: "Summary", quote: "Nearby canonical text" },
      body: "Canonical feedback",
    },
    {
      scope: "file",
      path: "deliverables/pack.pdf",
      body: "PDF feedback",
    },
    {
      scope: "line",
      path: "sources/report.html",
      line: 7,
      quote: "<p>Exact source</p>",
      body: "HTML feedback",
    },
    {
      scope: "rendered",
      format: "md",
      path: "deliverables/memo.md",
      quote: "Bandersnatch metric holds firm",
      prefix: "The ",
      suffix: " across revisions",
      start: 4,
      end: 34,
      selectorVersion: 1,
      body: "Rendered Mirror feedback",
    },
    { scope: "review", body: "Review feedback" },
  ];

  it.each(anchors)(
    "submits a $scope anchor and parses its comment",
    async (anchor) => {
      const fetcher = vi.fn(async () =>
        jsonResponse(
          {
            success: true,
            data: {
              ...anchor,
              id: "comment-38",
              headSha: "1234567890abcdef",
              roundNumber: 2,
              createdAt: "2026-07-13T12:00:00.000Z",
              resolved: false,
              carriedForward: false,
              drifted: false,
            },
          },
          201,
        ),
      );
      const reviewSurface = createReviewSurfaceApi(
        createApiClient({ baseUrl: "http://api.test", fetcher }),
      );

      await expect(
        reviewSurface.createFeedback("owner name", "repo/name", 38, anchor),
      ).resolves.toMatchObject(anchor);
      expect(fetcher).toHaveBeenCalledWith(
        "http://api.test/pr/owner%20name/repo%2Fname/38/comments",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(anchor),
        }),
      );
    },
  );

  it("rejects a malformed feedback response at the contract boundary", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: {
          scope: "review",
          body: "Missing every server-owned field",
        },
      }),
    );
    const reviewSurface = createReviewSurfaceApi(
      createApiClient({ baseUrl: "http://api.test", fetcher }),
    );

    await expect(
      reviewSurface.createFeedback("owner", "repo", 38, {
        scope: "review",
        body: "Malformed response gate",
      }),
    ).rejects.toMatchObject({
      name: "ApiClientError",
      message: "Invalid API response",
    });
  });

  const artifactData = {
    pr: "owner/repo#38",
    headSha: "1234567890abcdef",
    reviewRound: 1,
    approved: false,
    comments: [],
  };

  it("finishes the round via PATCH /review/current and parses the artifact", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ success: true, data: artifactData }, 200),
    );
    const reviewSurface = createReviewSurfaceApi(
      createApiClient({ baseUrl: "http://api.test", fetcher }),
    );

    await expect(
      reviewSurface.finishRound("owner name", "repo/name", 38),
    ).resolves.toEqual(artifactData);
    expect(fetcher).toHaveBeenCalledWith(
      "http://api.test/pr/owner%20name/repo%2Fname/38/review/current",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ status: "finished" }),
      }),
    );
  });

  it("resolves a comment via PATCH /comments/:id and parses the comment", async () => {
    const resolvedComment = {
      scope: "review" as const,
      body: "Resolved comment",
      id: "comment-39",
      headSha: "1234567890abcdef",
      roundNumber: 1,
      createdAt: "2026-07-14T00:00:00.000Z",
      resolved: true,
      carriedForward: true,
      drifted: false,
    };
    const fetcher = vi.fn(async () =>
      jsonResponse({ success: true, data: resolvedComment }, 200),
    );
    const reviewSurface = createReviewSurfaceApi(
      createApiClient({ baseUrl: "http://api.test", fetcher }),
    );

    await expect(
      reviewSurface.resolveComment("owner", "repo", 38, "comment 39/x"),
    ).resolves.toMatchObject({ id: "comment-39", resolved: true });
    expect(fetcher).toHaveBeenCalledWith(
      "http://api.test/pr/owner/repo/38/comments/comment%2039%2Fx",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ resolved: true }),
      }),
    );
  });

  it("approves the round via PATCH /review/current and parses the artifact", async () => {
    const approvedArtifact = { ...artifactData, approved: true };
    const fetcher = vi.fn(async () =>
      jsonResponse({ success: true, data: approvedArtifact }, 200),
    );
    const reviewSurface = createReviewSurfaceApi(
      createApiClient({ baseUrl: "http://api.test", fetcher }),
    );

    await expect(
      reviewSurface.approveRound("owner", "repo", 38),
    ).resolves.toEqual(approvedArtifact);
    expect(fetcher).toHaveBeenCalledWith(
      "http://api.test/pr/owner/repo/38/review/current",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ status: "approved" }),
      }),
    );
  });

  it("reads the current artifact via GET /review/current", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ success: true, data: artifactData }),
    );
    const reviewSurface = createReviewSurfaceApi(
      createApiClient({ baseUrl: "http://api.test", fetcher }),
    );

    await expect(
      reviewSurface.getCurrentArtifact("owner", "repo", 38),
    ).resolves.toEqual(artifactData);
    expect(fetcher).toHaveBeenCalledWith(
      "http://api.test/pr/owner/repo/38/review/current",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("rejects a malformed artifact response at the contract boundary", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: { ...artifactData, comments: [{ resolved: true }] },
      }),
    );
    const reviewSurface = createReviewSurfaceApi(
      createApiClient({ baseUrl: "http://api.test", fetcher }),
    );

    await expect(
      reviewSurface.finishRound("owner", "repo", 38),
    ).rejects.toMatchObject({
      name: "ApiClientError",
      message: "Invalid API response",
    });
  });
});
