import { ConfigService } from "@nestjs/config";
import { GitHubApiError, GitHubTimeoutError } from "./github-api.error";
import { GitHubApiSource } from "./github-api.source";

// A recorded outbound request, captured by the fake fetch so tests can assert the
// transport boundary (method, headers, url) without touching the network.
interface RecordedCall {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
  signal: AbortSignal | null | undefined;
}

// Build a fake `fetch` from an ordered queue of responses. Each call records its
// arguments and returns the next staged response, so a test controls exactly what
// the adapter sees and can inspect what it sent.
type FakeFetchResult = Response | { rejects: unknown };

function fakeFetch(responses: FakeFetchResult[]): {
  fetchFn: typeof fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const queue = [...responses];
  const fetchFn = ((input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    calls.push({
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: init?.body ?? null,
      signal: init?.signal,
    });
    const next = queue.shift();
    if (!next) {
      throw new Error("fake fetch: no staged response for call");
    }
    if (next instanceof Response) {
      return Promise.resolve(next);
    }
    return Promise.reject(next.rejects);
  }) as typeof fetch;
  return { fetchFn, calls };
}

// A ConfigService stub that returns a fixed token for `githubToken`.
function configWithToken(token: string | undefined): ConfigService {
  return {
    get: (key: string) => (key === "githubToken" ? token : undefined),
  } as unknown as ConfigService;
}

function configWithOwnerCredentials(
  credentials: Readonly<Record<string, string>>,
  legacyToken?: string,
): ConfigService {
  return {
    get: (key: string) => {
      if (key === "githubCredentialsByOwner") {
        return credentials;
      }
      if (key === "githubToken") {
        return legacyToken;
      }
      return undefined;
    },
  } as unknown as ConfigService;
}

function retryDependencies(options?: { now?: number; random?: number }): {
  sleep: jest.Mock<Promise<void>, [number]>;
  now: () => number;
  random: () => number;
} {
  return {
    sleep: jest.fn(async (_delayMs: number): Promise<void> => undefined),
    now: () => options?.now ?? 0,
    random: () => options?.random ?? 0,
  };
}

function pullItem(number: number): Record<string, unknown> {
  return {
    number,
    title: `PR ${number}`,
    head: { ref: `feature-${number}`, sha: `sha-${number}` },
    base: { ref: "main" },
    user: { login: `author-${number}` },
    created_at: "2026-01-01T00:00:00Z",
  };
}

function fileItem(index: number): Record<string, unknown> {
  return { filename: `path/file-${index}.txt`, status: "modified" };
}

describe("GitHubApiSource", () => {
  const repo = "owner/repo";

  describe("resource-owner credential transport", () => {
    const operationCases: ReadonlyArray<
      readonly [
        string,
        (source: GitHubApiSource) => Promise<unknown>,
        () => Response,
      ]
    > = [
      [
        "open-PR metadata",
        (source) => source.listOpenPullRequests("BiNdErYs/board-review"),
        () =>
          new Response(JSON.stringify([pullItem(1)]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ],
      [
        "single-PR metadata",
        (source) => source.getPullRequest("BiNdErYs/board-review", 1),
        () =>
          new Response(
            JSON.stringify({
              ...pullItem(1),
              body: "desc",
              html_url: "https://github.com/Binderys/board-review/pull/1",
              merged: false,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ],
      [
        "changed-file",
        (source) => source.listChangedFiles("BiNdErYs/board-review", 1),
        () =>
          new Response(JSON.stringify([fileItem(1)]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ],
      [
        "blob",
        (source) =>
          source.fetchBlob("BiNdErYs/board-review", "head-sha", "memo.md"),
        () =>
          new Response(Buffer.from("memo"), {
            status: 200,
            headers: { "Content-Type": "application/octet-stream" },
          }),
      ],
    ];

    it.each(operationCases)(
      "binds the original repo's resource-owner credential through the %s operation",
      async (_name, operation, response) => {
        const { fetchFn, calls } = fakeFetch([response()]);
        const source = new GitHubApiSource(
          configWithOwnerCredentials(
            {
              binderys: "BINDERYS_OWNER_TOKEN",
              "acme-legal": "ACME_OWNER_TOKEN",
            },
            "LEGACY_GLOBAL_TOKEN",
          ),
          fetchFn,
        );

        await operation(source);

        expect(calls).toHaveLength(1);
        expect(calls[0].headers.get("authorization")).toBe(
          "Bearer BINDERYS_OWNER_TOKEN",
        );
        expect(calls[0].headers.get("authorization")).not.toContain(
          "ACME_OWNER_TOKEN",
        );
        expect(calls[0].headers.get("authorization")).not.toContain(
          "LEGACY_GLOBAL_TOKEN",
        );
      },
    );

    it("shares a resource-owner credential across repos while separating owners", async () => {
      const { fetchFn, calls } = fakeFetch([
        new Response(JSON.stringify([pullItem(1)])),
        new Response(JSON.stringify([pullItem(2)])),
        new Response(JSON.stringify([pullItem(3)])),
      ]);
      const source = new GitHubApiSource(
        configWithOwnerCredentials({
          binderys: "BINDERYS_OWNER_TOKEN",
          "acme-legal": "ACME_OWNER_TOKEN",
        }),
        fetchFn,
      );

      await source.listOpenPullRequests("Binderys/board-review");
      await source.listOpenPullRequests("bInDeRyS/legal-review");
      await source.listOpenPullRequests("acme-legal/contracts");

      expect(calls.map((call) => call.headers.get("authorization"))).toEqual([
        "Bearer BINDERYS_OWNER_TOKEN",
        "Bearer BINDERYS_OWNER_TOKEN",
        "Bearer ACME_OWNER_TOKEN",
      ]);
      expect(calls[0].headers.get("authorization")).not.toContain(
        "ACME_OWNER_TOKEN",
      );
      expect(calls[2].headers.get("authorization")).not.toContain(
        "BINDERYS_OWNER_TOKEN",
      );
    });

    it("keeps the original resource-owner credential when pagination names another owner", async () => {
      const { fetchFn, calls } = fakeFetch([
        new Response(JSON.stringify([pullItem(1)]), {
          headers: {
            Link: '<https://api.github.com/repos/acme-legal/contracts/pulls?page=2>; rel="next"',
          },
        }),
        new Response(JSON.stringify([pullItem(2)])),
      ]);
      const source = new GitHubApiSource(
        configWithOwnerCredentials({
          binderys: "BINDERYS_OWNER_TOKEN",
          "acme-legal": "ACME_OWNER_TOKEN",
        }),
        fetchFn,
      );

      await source.listOpenPullRequests("Binderys/board-review");

      expect(calls).toHaveLength(2);
      expect(calls[1].url).toContain("/repos/acme-legal/contracts/");
      for (const call of calls) {
        expect(call.headers.get("authorization")).toBe(
          "Bearer BINDERYS_OWNER_TOKEN",
        );
        expect(call.headers.get("authorization")).not.toContain(
          "ACME_OWNER_TOKEN",
        );
      }
    });

    it("keeps development reads anonymous when no credential is configured", async () => {
      const { fetchFn, calls } = fakeFetch([
        new Response(JSON.stringify([pullItem(1)])),
      ]);
      const source = new GitHubApiSource(
        configWithOwnerCredentials({}),
        fetchFn,
      );

      await source.listOpenPullRequests("Binderys/board-review");

      expect(calls).toHaveLength(1);
      expect(calls[0].headers.has("authorization")).toBe(false);
    });

    it.each([
      [undefined, null],
      ["LEGACY_GLOBAL_TOKEN", "Bearer LEGACY_GLOBAL_TOKEN"],
    ])(
      "does not treat an inherited record property as a resource-owner credential",
      async (legacyToken, expectedAuthorization) => {
        const { fetchFn, calls } = fakeFetch([
          new Response(JSON.stringify([pullItem(1)])),
        ]);
        const source = new GitHubApiSource(
          configWithOwnerCredentials({}, legacyToken),
          fetchFn,
        );

        await source.listOpenPullRequests("constructor/board-review");

        expect(calls).toHaveLength(1);
        expect(calls[0].headers.get("authorization")).toBe(
          expectedAuthorization,
        );
      },
    );
  });

  it("reports whether the pull request has merged", async () => {
    const { fetchFn } = fakeFetch([
      new Response(
        JSON.stringify({
          ...pullItem(7),
          body: "Merged detail",
          html_url: "https://github.com/owner/repo/pull/7",
          merged: true,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ]);
    const source = new GitHubApiSource(configWithToken("tok"), fetchFn);

    await expect(source.getPullRequest(repo, 7)).resolves.toMatchObject({
      number: 7,
      merged: true,
    });
  });

  describe("fetchBlob", () => {
    it("returns the exact binary bytes of a 1-100 MB blob via the raw media type", async () => {
      // ~2 MB of non-trivial bytes: a repeating but non-uniform pattern.
      const size = 2 * 1024 * 1024;
      const original = Buffer.alloc(size);
      for (let i = 0; i < size; i++) {
        original[i] = (i * 31 + 7) % 256;
      }

      const { fetchFn, calls } = fakeFetch([
        new Response(original, {
          status: 200,
          headers: { "Content-Type": "application/octet-stream" },
        }),
      ]);
      const source = new GitHubApiSource(configWithToken("t"), fetchFn);

      const blob = await source.fetchBlob(repo, "abc123", "docs/big.bin");

      expect(Buffer.isBuffer(blob.bytes)).toBe(true);
      expect(blob.bytes.length).toBe(size);
      expect(blob.bytes.equals(original)).toBe(true);
      expect(blob.path).toBe("docs/big.bin");
      expect(blob.ref).toBe("abc123");

      expect(calls).toHaveLength(1);
      expect(calls[0].headers.get("accept")).toBe("application/vnd.github.raw");
      expect(calls[0].signal).toBeUndefined();
      expect(calls[0].url).toContain("/repos/owner/repo/contents/docs/big.bin");
      expect(calls[0].url).toContain("ref=abc123");
    });

    it("throws when a raw blob request returns a JSON body (the empty-success regression guard)", async () => {
      const { fetchFn } = fakeFetch([
        new Response(JSON.stringify({ content: "", encoding: "none" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ]);
      const source = new GitHubApiSource(configWithToken("t"), fetchFn);

      await expect(
        source.fetchBlob(repo, "abc123", "docs/big.bin"),
      ).rejects.toThrow(/JSON response for a raw blob/);
    });

    it("throws a typed error surfacing the status when the blob is above GitHub's limit", async () => {
      const { fetchFn } = fakeFetch([
        new Response("forbidden", { status: 403, statusText: "Forbidden" }),
      ]);
      const source = new GitHubApiSource(configWithToken("t"), fetchFn);

      const error = await source
        .fetchBlob(repo, "abc123", "docs/huge.bin")
        .catch((err: unknown) => err);
      expect(error).toBeInstanceOf(GitHubApiError);
      expect((error as GitHubApiError).status).toBe(403);
      expect((error as GitHubApiError).message).toMatch(/403/);
    });

    it("throws on a 204 rather than returning an empty Buffer", async () => {
      const { fetchFn } = fakeFetch([new Response(null, { status: 204 })]);
      const source = new GitHubApiSource(configWithToken("t"), fetchFn);

      await expect(
        source.fetchBlob(repo, "abc123", "docs/empty.bin"),
      ).rejects.toThrow(/unexpected status 204/);
    });

    it("throws on a 206 rather than returning a truncated Buffer", async () => {
      const { fetchFn } = fakeFetch([
        new Response(Buffer.from("partial"), {
          status: 206,
          headers: { "Content-Type": "application/octet-stream" },
        }),
      ]);
      const source = new GitHubApiSource(configWithToken("t"), fetchFn);

      await expect(
        source.fetchBlob(repo, "abc123", "docs/part.bin"),
      ).rejects.toThrow(/unexpected status 206/);
    });
  });

  describe("listOpenPullRequests", () => {
    it("follows Link pagination and returns every PR exactly once in order", async () => {
      const page1 = Array.from({ length: 100 }, (_, i) => pullItem(i + 1));
      const page2 = Array.from({ length: 30 }, (_, i) => pullItem(i + 101));

      const { fetchFn, calls } = fakeFetch([
        new Response(JSON.stringify(page1), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: '<https://api.github.com/repos/owner/repo/pulls?state=open&per_page=100&page=2>; rel="next"',
          },
        }),
        new Response(JSON.stringify(page2), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ]);
      const source = new GitHubApiSource(configWithToken("tok"), fetchFn);

      const pulls = await source.listOpenPullRequests(repo);

      expect(pulls).toHaveLength(130);
      expect(pulls.map((p) => p.number)).toEqual(
        Array.from({ length: 130 }, (_, i) => i + 1),
      );
      expect(new Set(pulls.map((p) => p.number)).size).toBe(130);

      expect(calls).toHaveLength(2);
      expect(calls[1].url).toContain("page=2");
      for (const call of calls) {
        expect(call.method).toBe("GET");
        expect(call.headers.get("authorization")).toBe("Bearer tok");
        expect(call.headers.get("x-github-api-version")).toBe("2022-11-28");
      }
    });

    it("throws on a malformed PR element rather than emitting bad data", async () => {
      const { fetchFn } = fakeFetch([
        new Response(JSON.stringify([pullItem(1), {}]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ]);
      const source = new GitHubApiSource(configWithToken("tok"), fetchFn);

      await expect(source.listOpenPullRequests(repo)).rejects.toThrow(
        /invalid shape/,
      );
    });

    it("throws when a later page is a 2xx non-array body instead of silently truncating", async () => {
      const page1 = Array.from({ length: 100 }, (_, i) => pullItem(i + 1));

      const { fetchFn } = fakeFetch([
        new Response(JSON.stringify(page1), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: '<https://api.github.com/repos/owner/repo/pulls?state=open&per_page=100&page=2>; rel="next"',
          },
        }),
        new Response(JSON.stringify({ message: "unexpected shape" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ]);
      const source = new GitHubApiSource(configWithToken("tok"), fetchFn);

      await expect(source.listOpenPullRequests(repo)).rejects.toThrow(
        /non-array page/,
      );
    });

    it("refuses to follow an off-origin next link and never sends the token there", async () => {
      const page1 = Array.from({ length: 100 }, (_, i) => pullItem(i + 1));

      const { fetchFn, calls } = fakeFetch([
        new Response(JSON.stringify(page1), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: '<https://attacker.example/repos/owner/repo/pulls?page=2>; rel="next"',
          },
        }),
      ]);
      const source = new GitHubApiSource(configWithToken("tok"), fetchFn);

      await expect(source.listOpenPullRequests(repo)).rejects.toThrow(
        /non-GitHub origin/,
      );
      // Only the first (GitHub) request was ever issued; the attacker URL was
      // rejected before fetch, so the bearer token never left the origin.
      expect(calls).toHaveLength(1);
      expect(calls.some((call) => call.url.includes("attacker.example"))).toBe(
        false,
      );
    });

    it("refuses an off-origin next link even when its scheme is uppercase", async () => {
      const page1 = Array.from({ length: 100 }, (_, i) => pullItem(i + 1));

      const { fetchFn, calls } = fakeFetch([
        new Response(JSON.stringify(page1), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: '<HTTPS://attacker.example/repos/owner/repo/pulls?page=2>; rel="next"',
          },
        }),
      ]);
      const source = new GitHubApiSource(configWithToken("tok"), fetchFn);

      await expect(source.listOpenPullRequests(repo)).rejects.toThrow(
        /non-GitHub origin/,
      );
      // The uppercase scheme must not bypass the origin pin: only the first
      // GitHub request was issued, and the attacker URL never saw the token.
      expect(calls).toHaveLength(1);
      expect(calls.some((call) => call.url.includes("attacker.example"))).toBe(
        false,
      );
    });
  });

  describe("listChangedFiles", () => {
    it("follows Link pagination and returns every changed file exactly once in order", async () => {
      const page1 = Array.from({ length: 100 }, (_, i) => fileItem(i + 1));
      const page2 = Array.from({ length: 30 }, (_, i) => fileItem(i + 101));

      const { fetchFn, calls } = fakeFetch([
        new Response(JSON.stringify(page1), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: '<https://api.github.com/repos/owner/repo/pulls/7/files?per_page=100&page=2>; rel="next"',
          },
        }),
        new Response(JSON.stringify(page2), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ]);
      const source = new GitHubApiSource(configWithToken("tok"), fetchFn);

      const files = await source.listChangedFiles(repo, 7);

      expect(files).toHaveLength(130);
      expect(files.map((f) => f.path)).toEqual(
        Array.from({ length: 130 }, (_, i) => `path/file-${i + 1}.txt`),
      );
      expect(new Set(files.map((f) => f.path)).size).toBe(130);
      expect(calls).toHaveLength(2);
    });

    it("throws on a changed-file element missing filename rather than emitting bad data", async () => {
      const { fetchFn } = fakeFetch([
        new Response(JSON.stringify([fileItem(1), { status: "modified" }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ]);
      const source = new GitHubApiSource(configWithToken("tok"), fetchFn);

      await expect(source.listChangedFiles(repo, 7)).rejects.toThrow(
        /invalid shape/,
      );
    });

    it("maps previous_filename to previousPath for a rename, leaving ordinary files without one", async () => {
      const { fetchFn } = fakeFetch([
        new Response(
          JSON.stringify([
            {
              filename: "new/path.md",
              status: "renamed",
              previous_filename: "old/path.md",
            },
            fileItem(1),
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ]);
      const source = new GitHubApiSource(configWithToken("tok"), fetchFn);

      const files = await source.listChangedFiles(repo, 7);

      expect(files[0]).toEqual({
        path: "new/path.md",
        status: "renamed",
        previousPath: "old/path.md",
      });
      expect(files[1].previousPath).toBeUndefined();
    });

    it("throws on a changed-file element whose previous_filename is present but not a string", async () => {
      const { fetchFn } = fakeFetch([
        new Response(
          JSON.stringify([
            {
              filename: "new/path.md",
              status: "renamed",
              previous_filename: 42,
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ]);
      const source = new GitHubApiSource(configWithToken("tok"), fetchFn);

      await expect(source.listChangedFiles(repo, 7)).rejects.toThrow(
        /invalid shape/,
      );
    });
  });

  describe("read-only boundary", () => {
    it("issues only GET requests with no body across every operation", async () => {
      const { fetchFn, calls } = fakeFetch([
        // listOpenPullRequests (single page)
        new Response(JSON.stringify([pullItem(1)]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
        // getPullRequest
        new Response(
          JSON.stringify({
            ...pullItem(1),
            body: "desc",
            html_url: "https://github.com/owner/repo/pull/1",
            merged: false,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
        // listChangedFiles (single page)
        new Response(JSON.stringify([fileItem(1)]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
        // fetchBlob
        new Response(Buffer.from("hello"), {
          status: 200,
          headers: { "Content-Type": "application/octet-stream" },
        }),
      ]);
      const source = new GitHubApiSource(configWithToken("tok"), fetchFn);

      await source.listOpenPullRequests(repo);
      await source.getPullRequest(repo, 1);
      await source.listChangedFiles(repo, 1);
      await source.fetchBlob(repo, "abc123", "a.txt");

      expect(calls).toHaveLength(4);
      for (const call of calls) {
        expect(call.method).toBe("GET");
        expect(call.body).toBeNull();
      }
    });
  });

  describe("typed upstream errors", () => {
    it("throws GitHubApiError carrying status, code, and documentation url from a JSON error body", async () => {
      const { fetchFn } = fakeFetch([
        new Response(
          JSON.stringify({
            message: "Validation Failed",
            documentation_url: "https://docs.github.com/rest",
            errors: [{ code: "invalid" }],
          }),
          {
            status: 422,
            statusText: "Unprocessable Entity",
            headers: { "Content-Type": "application/json" },
          },
        ),
      ]);
      const source = new GitHubApiSource(configWithToken("tok"), fetchFn);

      const error = await source
        .listOpenPullRequests(repo)
        .catch((err: unknown) => err);
      expect(error).toBeInstanceOf(GitHubApiError);
      const typed = error as GitHubApiError;
      expect(typed.status).toBe(422);
      expect(typed.code).toBe("invalid");
      expect(typed.documentationUrl).toBe("https://docs.github.com/rest");
      expect(typed.message).toMatch(/422/);
      expect(typed.message).toMatch(/Validation Failed/);
    });

    it("throws GitHubApiError with the status and no secondary parse error on a non-JSON body", async () => {
      const { fetchFn } = fakeFetch(
        Array.from(
          { length: 3 },
          () =>
            new Response("gateway blew up", {
              status: 502,
              statusText: "Bad Gateway",
              headers: { "Content-Type": "text/plain" },
            }),
        ),
      );
      const source = new GitHubApiSource(
        configWithToken("tok"),
        fetchFn,
        retryDependencies(),
      );

      const error = await source
        .listOpenPullRequests(repo)
        .catch((err: unknown) => err);
      expect(error).toBeInstanceOf(GitHubApiError);
      const typed = error as GitHubApiError;
      expect(typed.status).toBe(502);
      expect(typed.code).toBeUndefined();
      expect(typed.documentationUrl).toBeUndefined();
      expect(typed.message).toMatch(/502/);
    });
  });

  describe("retry policy", () => {
    it("recovers when a transient GitHub failure is followed by success", async () => {
      const { fetchFn, calls } = fakeFetch([
        new Response("gateway unavailable", {
          status: 502,
          statusText: "Bad Gateway",
        }),
        new Response(JSON.stringify([pullItem(1)]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ]);
      const source = new GitHubApiSource(
        configWithToken("tok"),
        fetchFn,
        retryDependencies(),
      );

      await expect(source.listOpenPullRequests(repo)).resolves.toMatchObject([
        { number: 1 },
      ]);
      expect(calls).toHaveLength(2);
    });

    it("honors Retry-After on a transient server failure", async () => {
      const { fetchFn } = fakeFetch([
        new Response("temporarily unavailable", {
          status: 503,
          statusText: "Service Unavailable",
          headers: { "Retry-After": "2" },
        }),
        new Response(JSON.stringify([pullItem(1)]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ]);
      const retry = retryDependencies();
      const source = new GitHubApiSource(
        configWithToken("tok"),
        fetchFn,
        retry,
      );

      await expect(source.listOpenPullRequests(repo)).resolves.toHaveLength(1);
      expect(retry.sleep).toHaveBeenCalledWith(2_000);
    });

    it("honors an HTTP-date Retry-After", async () => {
      const { fetchFn } = fakeFetch([
        new Response("temporarily unavailable", {
          status: 503,
          statusText: "Service Unavailable",
          headers: { "Retry-After": "Wed, 21 Oct 2026 07:28:02 GMT" },
        }),
        new Response(JSON.stringify([pullItem(1)]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ]);
      const retry = retryDependencies({
        now: Date.parse("Wed, 21 Oct 2026 07:28:00 GMT"),
      });
      const source = new GitHubApiSource(
        configWithToken("tok"),
        fetchFn,
        retry,
      );

      await expect(source.listOpenPullRequests(repo)).resolves.toHaveLength(1);
      expect(retry.sleep).toHaveBeenCalledWith(2_000);
    });

    it("recovers from an HTTP request-timeout response", async () => {
      const { fetchFn, calls } = fakeFetch([
        new Response("request timed out", {
          status: 408,
          statusText: "Request Timeout",
        }),
        new Response(JSON.stringify([pullItem(1)]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ]);
      const source = new GitHubApiSource(
        configWithToken("tok"),
        fetchFn,
        retryDependencies(),
      );

      await expect(source.listOpenPullRequests(repo)).resolves.toHaveLength(1);
      expect(calls).toHaveLength(2);
    });

    it("honors a short GitHub Retry-After before retrying a rate-limited request", async () => {
      const { fetchFn, calls } = fakeFetch([
        new Response("rate limited", {
          status: 403,
          statusText: "Forbidden",
          headers: {
            "Retry-After": "1",
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": "105",
          },
        }),
        new Response(JSON.stringify([pullItem(1)]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ]);
      const retry = retryDependencies({ now: 100_000 });
      const source = new GitHubApiSource(
        configWithToken("tok"),
        fetchFn,
        retry,
      );

      await expect(source.listOpenPullRequests(repo)).resolves.toHaveLength(1);
      expect(calls).toHaveLength(2);
      expect(retry.sleep).toHaveBeenCalledWith(1_000);
    });

    it("uses GitHub's reset time when the primary rate limit is exhausted", async () => {
      const { fetchFn } = fakeFetch([
        new Response("rate limited", {
          status: 403,
          statusText: "Forbidden",
          headers: {
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": "105",
          },
        }),
        new Response(JSON.stringify([pullItem(1)]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ]);
      const retry = retryDependencies({ now: 100_000 });
      const source = new GitHubApiSource(
        configWithToken("tok"),
        fetchFn,
        retry,
      );

      await expect(source.listOpenPullRequests(repo)).resolves.toHaveLength(1);
      expect(retry.sleep).toHaveBeenCalledWith(5_000);
    });

    it("recovers when a pre-response timeout is followed by success", async () => {
      const timeout = new DOMException("request timed out", "TimeoutError");
      const { fetchFn, calls } = fakeFetch([
        { rejects: timeout },
        new Response(JSON.stringify([pullItem(1)]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ]);
      const source = new GitHubApiSource(
        configWithToken("tok"),
        fetchFn,
        retryDependencies(),
      );

      await expect(source.listOpenPullRequests(repo)).resolves.toHaveLength(1);
      expect(calls).toHaveLength(2);
    });

    it("recognizes the Node transport's pre-response timeout cause", async () => {
      const timeout = new TypeError("fetch failed", {
        cause: { code: "UND_ERR_CONNECT_TIMEOUT" },
      });
      const { fetchFn } = fakeFetch([
        { rejects: timeout },
        new Response(JSON.stringify([pullItem(1)]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ]);
      const source = new GitHubApiSource(
        configWithToken("tok"),
        fetchFn,
        retryDependencies(),
      );

      await expect(source.listOpenPullRequests(repo)).resolves.toHaveLength(1);
    });

    it("throws the final typed HTTP error after three attempts", async () => {
      const { fetchFn, calls } = fakeFetch([
        new Response(JSON.stringify({ message: "first" }), {
          status: 503,
          statusText: "Service Unavailable",
          headers: { "Content-Type": "application/json" },
        }),
        new Response(JSON.stringify({ message: "second" }), {
          status: 503,
          statusText: "Service Unavailable",
          headers: { "Content-Type": "application/json" },
        }),
        new Response(
          JSON.stringify({
            message: "final",
            documentation_url: "https://docs.github.com/rest",
            errors: [{ code: "temporarily_unavailable" }],
          }),
          {
            status: 503,
            statusText: "Service Unavailable",
            headers: { "Content-Type": "application/json" },
          },
        ),
      ]);
      const retry = retryDependencies({ random: 0.5 });
      const source = new GitHubApiSource(
        configWithToken("tok"),
        fetchFn,
        retry,
      );

      const error = await source
        .listOpenPullRequests(repo)
        .catch((cause: unknown) => cause);

      expect(error).toBeInstanceOf(GitHubApiError);
      expect(error).toMatchObject({
        status: 503,
        code: "temporarily_unavailable",
        documentationUrl: "https://docs.github.com/rest",
        message: expect.stringContaining("final"),
      });
      expect(calls).toHaveLength(3);
      expect(retry.sleep.mock.calls).toEqual([[250], [500]]);
    });

    it("does not retry when GitHub's minimum wait exceeds the delay ceiling", async () => {
      const { fetchFn, calls } = fakeFetch([
        new Response("rate limited", {
          status: 429,
          statusText: "Too Many Requests",
          headers: {
            "Retry-After": "6",
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": "106",
            "X-GitHub-Request-Id": "request-123",
          },
        }),
      ]);
      const retry = retryDependencies();
      const source = new GitHubApiSource(
        configWithToken("tok"),
        fetchFn,
        retry,
      );

      await expect(source.listOpenPullRequests(repo)).rejects.toMatchObject({
        status: 429,
        retryAfterSeconds: 6,
        rateLimitRemaining: 0,
        rateLimitResetEpochSeconds: 106,
        requestId: "request-123",
      });
      expect(calls).toHaveLength(1);
      expect(retry.sleep).not.toHaveBeenCalled();
    });

    it("does not retry a headerless 429 before GitHub's fallback wait", async () => {
      const { fetchFn, calls } = fakeFetch([
        new Response("rate limited", {
          status: 429,
          statusText: "Too Many Requests",
        }),
      ]);
      const retry = retryDependencies();
      const source = new GitHubApiSource(
        configWithToken("tok"),
        fetchFn,
        retry,
      );

      await expect(source.listOpenPullRequests(repo)).rejects.toBeInstanceOf(
        GitHubApiError,
      );
      expect(calls).toHaveLength(1);
      expect(retry.sleep).not.toHaveBeenCalled();
    });

    it("throws a typed timeout with the final cause after three attempts", async () => {
      const first = new DOMException("first", "TimeoutError");
      const second = new DOMException("second", "TimeoutError");
      const final = new DOMException("final", "TimeoutError");
      const { fetchFn, calls } = fakeFetch([
        { rejects: first },
        { rejects: second },
        { rejects: final },
      ]);
      const retry = retryDependencies();
      const source = new GitHubApiSource(
        configWithToken("tok"),
        fetchFn,
        retry,
      );

      const error = await source
        .listOpenPullRequests(repo)
        .catch((cause: unknown) => cause);

      expect(error).toBeInstanceOf(GitHubTimeoutError);
      expect((error as GitHubTimeoutError).cause).toBe(final);
      expect(calls).toHaveLength(3);
      expect(retry.sleep).toHaveBeenCalledTimes(2);
    });

    it("does not retry cancellation or an unclassified network failure", async () => {
      const failures = [
        new DOMException("cancelled", "AbortError"),
        new TypeError("fetch failed"),
      ];

      for (const failure of failures) {
        const { fetchFn, calls } = fakeFetch([{ rejects: failure }]);
        const retry = retryDependencies();
        const source = new GitHubApiSource(
          configWithToken("tok"),
          fetchFn,
          retry,
        );

        const error = await source
          .listOpenPullRequests(repo)
          .catch((cause: unknown) => cause);

        expect(error).toMatchObject({
          name: "GitHubTransportError",
          cause: failure,
        });
        expect(calls).toHaveLength(1);
        expect(retry.sleep).not.toHaveBeenCalled();
      }
    });

    it("retries a later page without duplicating the items already collected", async () => {
      const page1 = Array.from({ length: 100 }, (_, i) => pullItem(i + 1));
      const page2 = Array.from({ length: 30 }, (_, i) => pullItem(i + 101));
      const { fetchFn, calls } = fakeFetch([
        new Response(JSON.stringify(page1), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: '<https://api.github.com/repos/owner/repo/pulls?state=open&per_page=100&page=2>; rel="next"',
          },
        }),
        new Response("gateway unavailable", {
          status: 502,
          statusText: "Bad Gateway",
        }),
        new Response(JSON.stringify(page2), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ]);
      const source = new GitHubApiSource(
        configWithToken("tok"),
        fetchFn,
        retryDependencies(),
      );

      const pulls = await source.listOpenPullRequests(repo);

      expect(pulls.map((pull) => pull.number)).toEqual(
        Array.from({ length: 130 }, (_, i) => i + 1),
      );
      expect(calls).toHaveLength(3);
    });
  });
});
