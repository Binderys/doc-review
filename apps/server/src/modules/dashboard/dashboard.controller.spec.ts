import type { PullRequestListItem } from "@doc-review/api-contracts";
import { Logger, type INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../../app.module";
import { HttpExceptionFilter } from "../../common/filters/http-exception.filter";
import { ResponseInterceptor } from "../../common/interceptors/response.interceptor";
import { AppValidationPipe } from "../../common/pipes/validation.pipe";
import { DashboardController } from "./dashboard.controller";
import {
  GitHubApiError,
  GitHubTimeoutError,
  GitHubTransportError,
} from "./github/github-api.error";
import { FakeGitHubSource } from "./github/github-fake.source";
import { GITHUB_SOURCE_BACKEND } from "./github/github-source-backend";

const DEFAULT_REPO = "acme/board-review";

const pr = (
  overrides: Partial<PullRequestListItem> & { number: number },
): PullRequestListItem => ({
  title: `PR ${overrides.number}`,
  branch: `agent/pr-${overrides.number}`,
  author: "board-agent",
  createdAt: "2026-07-01T12:00:00.000Z",
  ...overrides,
});

// Boots the full app assembly with the same globals createApp() applies, so the
// seam test exercises production wiring (enveloped responses, exception filter),
// with the GitHub source overridden by the in-memory fake and, optionally, the
// watched-repo config overridden.
const buildApp = async (
  fake: FakeGitHubSource,
  watchedRepos?: string[],
): Promise<INestApplication> => {
  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GITHUB_SOURCE_BACKEND)
    .useValue(fake)
    .overrideProvider(ConfigService)
    .useValue({
      get: (key: string) =>
        key === "watchedRepos" ? (watchedRepos ?? [DEFAULT_REPO]) : undefined,
    });

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new AppValidationPipe());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());
  await app.init();
  return app;
};

describe("GET /dashboard (seam)", () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("returns each watched repo's open PRs grouped by repo", async () => {
    const fake = new FakeGitHubSource();
    fake.stageOpenPullRequests(DEFAULT_REPO, [
      pr({
        number: 42,
        title: "Draft Q3 IC memo",
        branch: "agent/ic-memo-q3",
        author: "board-agent",
        createdAt: "2026-07-01T12:00:00.000Z",
      }),
    ]);
    app = await buildApp(fake);

    const response = await request(app.getHttpServer())
      .get("/dashboard")
      .expect(200);

    expect(response.body).toEqual({
      success: true,
      data: {
        repos: [
          {
            repo: DEFAULT_REPO,
            status: "available",
            pullRequests: [
              {
                number: 42,
                title: "Draft Q3 IC memo",
                branch: "agent/ic-memo-q3",
                author: "board-agent",
                createdAt: "2026-07-01T12:00:00.000Z",
              },
            ],
          },
        ],
      },
    });
  });

  it("reflects a different PR set on reload (fake's second snapshot)", async () => {
    const fake = new FakeGitHubSource();
    fake.stageOpenPullRequests(
      DEFAULT_REPO,
      [pr({ number: 1 })],
      // Counter-fixture: PR 2 is absent from the first snapshot.
      [pr({ number: 1 }), pr({ number: 2 })],
    );
    app = await buildApp(fake);

    const first = await request(app.getHttpServer())
      .get("/dashboard")
      .expect(200);
    const second = await request(app.getHttpServer())
      .get("/dashboard")
      .expect(200);

    const numbersOf = (body: {
      data: { repos: { pullRequests: { number: number }[] }[] };
    }) => body.data.repos[0].pullRequests.map((item) => item.number);

    expect(numbersOf(first.body)).toEqual([1]);
    expect(numbersOf(second.body)).toEqual([1, 2]);
    expect(numbersOf(second.body)).toContain(2);
    expect(numbersOf(first.body)).not.toContain(2);
  });

  it("lists the repos from the overridden watched-repo config", async () => {
    const fake = new FakeGitHubSource();
    fake.stageOpenPullRequests("acme/alpha", [pr({ number: 10 })]);
    fake.stageOpenPullRequests("acme/beta", [pr({ number: 20 })]);
    app = await buildApp(fake, ["acme/alpha", "acme/beta"]);

    const response = await request(app.getHttpServer())
      .get("/dashboard")
      .expect(200);

    const repos = (
      response.body as { data: { repos: { repo: string }[] } }
    ).data.repos.map((group) => group.repo);
    expect(repos).toEqual(["acme/alpha", "acme/beta"]);
  });

  it("has no mutating routes (read-only invariant)", async () => {
    const fake = new FakeGitHubSource();
    fake.stageOpenPullRequests(DEFAULT_REPO, [pr({ number: 42 })]);
    app = await buildApp(fake);
    const server = app.getHttpServer();

    for (const path of ["/dashboard", "/health"]) {
      await request(server).post(path).expect(404);
      await request(server).put(path).expect(404);
      await request(server).patch(path).expect(404);
      await request(server).delete(path).expect(404);
    }
  });
});

describe("GET /dashboard availability (seam)", () => {
  let app: INestApplication | undefined;
  let loggerSpy: jest.SpyInstance;

  beforeEach(() => {
    loggerSpy = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    loggerSpy.mockRestore();
  });

  it("settles watched repos independently while preserving configured order", async () => {
    const firstRepo = "first-owner/private-docs";
    const secondRepo = "second-owner/healthy-docs";
    const fake = new FakeGitHubSource();
    const first = fake.deferOpenPullRequests(firstRepo);
    const second = fake.deferOpenPullRequests(secondRepo);
    app = await buildApp(fake, [firstRepo, secondRepo]);

    const responsePromise = request(app.getHttpServer())
      .get("/dashboard")
      .expect(200)
      .then((response) => response);

    await Promise.all([first.started, second.started]);
    second.resolve([pr({ number: 20 })]);
    first.reject(new GitHubApiError("planted provider prose", { status: 403 }));

    const response = await responsePromise;
    expect(response.body).toEqual({
      success: true,
      data: {
        repos: [
          {
            repo: firstRepo,
            status: "unavailable",
            reason: "access",
          },
          {
            repo: secondRepo,
            status: "available",
            pullRequests: [pr({ number: 20 })],
          },
        ],
      },
    });
  });

  it("returns HTTP 200 with every unavailable repo and its explicit state", async () => {
    const fake = new FakeGitHubSource();
    fake.stageOpenPullRequestFailure(
      "access-owner/docs",
      new GitHubApiError("Bad credentials", { status: 401 }),
    );
    fake.stageOpenPullRequestFailure(
      "limited-owner/docs",
      new GitHubApiError("API rate limit exceeded", { status: 429 }),
    );
    fake.stageOpenPullRequestFailure(
      "offline-owner/docs",
      new GitHubTransportError("fetch failed", new Error("socket closed")),
    );
    app = await buildApp(fake, [
      "access-owner/docs",
      "limited-owner/docs",
      "offline-owner/docs",
    ]);

    const response = await request(app.getHttpServer())
      .get("/dashboard")
      .expect(200);

    expect(response.body).toEqual({
      success: true,
      data: {
        repos: [
          {
            repo: "access-owner/docs",
            status: "unavailable",
            reason: "access",
          },
          {
            repo: "limited-owner/docs",
            status: "unavailable",
            reason: "rate-limited",
          },
          {
            repo: "offline-owner/docs",
            status: "unavailable",
            reason: "github-unavailable",
          },
        ],
      },
    });
  });

  it("keeps a healthy empty repo distinct from an unavailable repo", async () => {
    const fake = new FakeGitHubSource();
    fake.stageOpenPullRequests("healthy-owner/empty-docs", []);
    fake.stageOpenPullRequestFailure(
      "offline-owner/docs",
      new Error("malformed provider response"),
    );
    app = await buildApp(fake, [
      "healthy-owner/empty-docs",
      "offline-owner/docs",
    ]);

    const response = await request(app.getHttpServer())
      .get("/dashboard")
      .expect(200);

    expect(response.body).toEqual({
      success: true,
      data: {
        repos: [
          {
            repo: "healthy-owner/empty-docs",
            status: "available",
            pullRequests: [],
          },
          {
            repo: "offline-owner/docs",
            status: "unavailable",
            reason: "github-unavailable",
          },
        ],
      },
    });
  });

  it.each([
    {
      name: "authentication",
      failure: new GitHubApiError("auth", { status: 401 }),
      reason: "access",
    },
    {
      name: "authorization",
      failure: new GitHubApiError("authz", { status: 403 }),
      reason: "access",
    },
    {
      name: "not found",
      failure: new GitHubApiError("missing", { status: 404 }),
      reason: "access",
    },
    {
      name: "primary rate limit",
      failure: new GitHubApiError("limited", {
        status: 403,
        rateLimitRemaining: 0,
      }),
      reason: "rate-limited",
    },
    {
      name: "secondary rate limit",
      failure: new GitHubApiError("limited", {
        status: 403,
        retryAfterSeconds: 60,
      }),
      reason: "rate-limited",
    },
    {
      name: "HTTP 429",
      failure: new GitHubApiError("limited", { status: 429 }),
      reason: "rate-limited",
    },
    {
      name: "timeout",
      failure: new GitHubTimeoutError("timed out", new Error("timeout")),
      reason: "github-unavailable",
    },
    {
      name: "transport",
      failure: new GitHubTransportError("fetch failed", new Error("socket")),
      reason: "github-unavailable",
    },
    {
      name: "GitHub 5xx",
      failure: new GitHubApiError("down", { status: 503 }),
      reason: "github-unavailable",
    },
    {
      name: "malformed response",
      failure: new Error("invalid shape"),
      reason: "github-unavailable",
    },
    {
      name: "unknown exception",
      failure: { unexpected: true },
      reason: "github-unavailable",
    },
  ])("maps $name failures to $reason", async ({ failure, reason }) => {
    const fake = new FakeGitHubSource();
    fake.stageOpenPullRequestFailure(DEFAULT_REPO, failure);
    app = await buildApp(fake);

    const response = await request(app.getHttpServer())
      .get("/dashboard")
      .expect(200);

    expect(response.body).toEqual({
      success: true,
      data: {
        repos: [
          {
            repo: DEFAULT_REPO,
            status: "unavailable",
            reason,
          },
        ],
      },
    });
  });

  it("logs safe structured diagnostics without leaking provider prose or secrets", async () => {
    const plantedProviderProse = "API rate limit exceeded for this credential";
    const plantedSecret = "Bearer ghp_planted-secret";
    const failure = new GitHubApiError(
      `${plantedProviderProse}; authorization=${plantedSecret}`,
      {
        status: 429,
        code: "rate_limited",
        documentationUrl: "https://docs.github.com/rest/rate-limit",
        retryAfterSeconds: 30,
        rateLimitRemaining: 0,
        rateLimitResetEpochSeconds: 1_784_441_800,
        requestId: "provider-request-123",
      },
    );
    const fake = new FakeGitHubSource();
    fake.stageOpenPullRequestFailure(DEFAULT_REPO, failure);
    app = await buildApp(fake);

    const response = await request(app.getHttpServer())
      .get("/dashboard")
      .expect(200);

    expect(response.body).toEqual({
      success: true,
      data: {
        repos: [
          {
            repo: DEFAULT_REPO,
            status: "unavailable",
            reason: "rate-limited",
          },
        ],
      },
    });
    expect(loggerSpy).toHaveBeenCalledTimes(1);
    expect(loggerSpy.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        repo: DEFAULT_REPO,
        resourceOwner: "acme",
        reason: "rate-limited",
        providerStatus: 429,
        providerCode: "rate_limited",
        documentationUrl: "https://docs.github.com/rest/rate-limit",
        retryAfterSeconds: 30,
        rateLimitRemaining: 0,
        rateLimitResetEpochSeconds: 1_784_441_800,
        requestId: "provider-request-123",
      }),
    );

    const serializedResponse = JSON.stringify(response.body);
    const serializedDiagnostic = JSON.stringify(loggerSpy.mock.calls);
    expect(serializedResponse).not.toContain(plantedProviderProse);
    expect(serializedResponse).not.toContain(plantedSecret);
    expect(serializedResponse).not.toContain("provider-request-123");
    expect(serializedResponse).not.toContain("rateLimitRemaining");
    expect(serializedDiagnostic).not.toContain(plantedProviderProse);
    expect(serializedDiagnostic).not.toContain(plantedSecret);
  });
});

// Guards the read-only invariant at the source: the controller declares only a
// GET handler, so no decorator drift can add a mutating route unnoticed.
describe("DashboardController (read-only)", () => {
  it("declares exactly one handler", () => {
    const handlers = Object.getOwnPropertyNames(
      DashboardController.prototype,
    ).filter((name) => name !== "constructor");
    expect(handlers).toEqual(["getDashboard"]);
  });
});
