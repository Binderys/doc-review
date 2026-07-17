import type { PullRequestListItem } from "@doc-review/api-contracts";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../../app.module";
import { HttpExceptionFilter } from "../../common/filters/http-exception.filter";
import { ResponseInterceptor } from "../../common/interceptors/response.interceptor";
import { AppValidationPipe } from "../../common/pipes/validation.pipe";
import { DashboardController } from "./dashboard.controller";
import { FakeGitHubSource } from "./github/github-fake.source";
import { GitHubSource } from "./github/github-source";

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
    .overrideProvider(GitHubSource)
    .useValue(fake);

  if (watchedRepos) {
    builder.overrideProvider(ConfigService).useValue({
      get: (key: string) => (key === "watchedRepos" ? watchedRepos : undefined),
    });
  }

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
