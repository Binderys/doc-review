import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { AppModule } from "../../app.module";
import { HttpExceptionFilter } from "../../common/filters/http-exception.filter";
import { ResponseInterceptor } from "../../common/interceptors/response.interceptor";
import { AppValidationPipe } from "../../common/pipes/validation.pipe";
import { FakeGitHubSource } from "../dashboard/github/github-fake.source";
import type {
  ChangedFile,
  FileBlob,
  PullRequestMetadata,
} from "../dashboard/github/github-source";
import { GitHubSource } from "../dashboard/github/github-source";
import {
  reviewArtifactSchema,
  reviewCommentSchema,
  reviewRoundSchema,
  reviewSurfaceResponseSchema,
  type FeedbackAnchor,
} from "@doc-review/api-contracts";
import {
  buildMinimalDocx,
  buildRichCanonicalDocx,
} from "../../../test/fixtures/minimal-docx";
import {
  REVIEW_LOOP,
  reviewLoopMetadata,
  stageReviewLoop,
  stageReviewLoopSecondHead,
} from "../../../test/fixtures/review-loop";
import { ReviewController } from "./review.controller";
import { convertCanonicalHtml } from "./renderers/canonical-html";
import { normalizeHtmlReviewText } from "./renderers/html-review-text";
import { normalizeMirrorReviewText } from "./renderers/mirror-review-text";

const blob = (path: string, ref: string, text: string): FileBlob => ({
  path,
  ref,
  bytes: Buffer.from(text, "utf-8"),
});

const OWNER = "acme";
const REPO = "board-review";
const SLUG = `${OWNER}/${REPO}`;
const NUMBER = 42;
const HEAD_SHA = "9b8d7a6c5e4f32100123456789abcdef01234567";
const testStatePaths = new Set<string>();
const createTestStatePath = (): string =>
  join(tmpdir(), `doc-review-review-${process.pid}-${randomUUID()}.json`);

afterAll(async () => {
  await Promise.all(
    [...testStatePaths].map((path) =>
      rm(path, { force: true, recursive: true }),
    ),
  );
});

const meta: PullRequestMetadata = {
  number: NUMBER,
  title: "Draft Q3 IC memo",
  description: "Ships the canonical docx and its md mirror.",
  branch: "agent/ic-memo-q3",
  headSha: HEAD_SHA,
  baseBranch: "main",
  merged: false,
  author: "board-agent",
  createdAt: "2026-07-01T12:00:00.000Z",
  htmlUrl: `https://github.com/${SLUG}/pull/${NUMBER}`,
};

// The fixture PR: a canonical docx + its md mirror, an html, a pdf, an added file,
// a deleted file, and one unrenderable format (xlsx).
const changedFiles: ChangedFile[] = [
  { path: "deliverables/memo.docx", status: "modified" },
  { path: "deliverables/memo.md", status: "modified" },
  { path: "sources/research.html", status: "modified" },
  { path: "sources/prospectus.pdf", status: "modified" },
  { path: "deliverables/appendix.md", status: "added" },
  { path: "deliverables/old-memo.md", status: "removed" },
  { path: "data/model.xlsx", status: "modified" },
];

const buildApp = async (
  fake: FakeGitHubSource,
  statePath = createTestStatePath(),
): Promise<INestApplication> => {
  process.env.REVIEW_STATE_PATH = statePath;
  testStatePaths.add(statePath);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GitHubSource)
    .useValue(fake)
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new AppValidationPipe());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());
  await app.init();
  return app;
};

const reconcileReview = async (
  app: INestApplication,
  route: string,
): Promise<void> => {
  await request(app.getHttpServer())
    .post(`${route}/review/reconcile`)
    .expect(200);
};

// A loose read-alias for the wrapped HTTP body: supertest yields `response.body` as
// `any`, so this narrows field access ergonomically without per-arm union narrowing.
// It is NOT an app wire type - the authoritative wire shape is
// `reviewSurfaceResponseSchema` from `@doc-review/api-contracts`, which the seam test
// below validates the actual response against.
type ReviewBody = {
  data: {
    number: number;
    title: string;
    description: string;
    sourceBranchUrl: string;
    githubUrl: string;
    currentRound: {
      number: number;
      headSha: string;
      comments: unknown[];
    };
    rounds: { number: number; headSha: string; comments: unknown[] }[];
    files: {
      path: string;
      changeType: string;
      payload: {
        format: string;
        blobUrl?: string;
        filename?: string;
        raw?: string;
        comparisonUrl?: string | null;
        diff?: { value: string; added?: boolean; removed?: boolean }[];
        sourceDiff?: {
          oldLine?: number;
          newLine?: number;
          text: string;
          change: "context" | "added" | "removed";
        }[];
        renderedHead?: string;
        reviewText?: string;
      };
    }[];
  };
};

describe("GET /pr/:owner/:repo/:number (seam)", () => {
  let app: INestApplication | undefined;

  const stagedFake = (): FakeGitHubSource => {
    const fake = new FakeGitHubSource();
    fake.setPullRequest(SLUG, meta);
    fake.setChangedFiles(SLUG, NUMBER, changedFiles);
    // The md renderer fetches base (at baseBranch) and head (at branch) text for
    // each md file; seed them so the surface assembles. A modified file has both
    // sides, an added file only head, a deleted file only base.
    fake.setBlob(
      SLUG,
      meta.headSha,
      blob("deliverables/memo.md", meta.headSha, "# Memo\n\nBody.\n"),
    );
    fake.setBlob(
      SLUG,
      meta.baseBranch,
      blob("deliverables/memo.md", meta.baseBranch, "# Memo\n\nOld body.\n"),
    );
    fake.setBlob(
      SLUG,
      meta.headSha,
      blob("deliverables/appendix.md", meta.headSha, "# Appendix\n"),
    );
    fake.setBlob(
      SLUG,
      meta.baseBranch,
      blob("deliverables/old-memo.md", meta.baseBranch, "# Old memo\n"),
    );
    // The docx renderer (#9) fetches the head bytes for the canonical docx; seed it
    // as a real minimal .docx so the surface assembles.
    fake.setBlob(SLUG, meta.headSha, {
      path: "deliverables/memo.docx",
      ref: meta.headSha,
      bytes: buildMinimalDocx("Memo body."),
    });
    // The html renderer (#10, #37) fetches head and base bytes for the html source
    // (base for its line-addressable source diff); seed both so the surface assembles.
    // The pdf renderer embeds a blobUrl and fetches nothing.
    fake.setBlob(
      SLUG,
      meta.headSha,
      blob(
        "sources/research.html",
        meta.headSha,
        "<html><body>Research.</body></html>",
      ),
    );
    fake.setBlob(
      SLUG,
      meta.baseBranch,
      blob(
        "sources/research.html",
        meta.baseBranch,
        "<html><body>Old research.</body></html>",
      ),
    );
    return fake;
  };

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("returns PR metadata + source-branch link + every changed file", async () => {
    app = await buildApp(stagedFake());
    await reconcileReview(app, `/pr/${SLUG}/${NUMBER}`);

    const response = await request(app.getHttpServer())
      .get(`/pr/${SLUG}/${NUMBER}`)
      .expect(200);
    const body = response.body as ReviewBody;

    // The server's response conforms to the shared contract at the wire boundary -
    // the payloads (including the #37 source diffs) parse against the schema.
    expect(reviewSurfaceResponseSchema.safeParse(body.data).success).toBe(true);

    expect(body.data.number).toBe(NUMBER);
    expect(body.data.title).toBe("Draft Q3 IC memo");
    expect(body.data.description).toBe(
      "Ships the canonical docx and its md mirror.",
    );
    expect(body.data.sourceBranchUrl).toBe(
      `https://github.com/${SLUG}/tree/agent/ic-memo-q3`,
    );
    expect(body.data.currentRound.headSha).toBe(HEAD_SHA);
    expect(body.data.currentRound.number).toBe(1);
    expect(body.data.rounds).toHaveLength(1);

    // Every changed file is present, in order - none dropped.
    expect(body.data.files.map((file) => file.path)).toEqual(
      changedFiles.map((file) => file.path),
    );
  });

  it("marks added and deleted files with the correct change type", async () => {
    app = await buildApp(stagedFake());
    await reconcileReview(app, `/pr/${SLUG}/${NUMBER}`);

    const response = await request(app.getHttpServer())
      .get(`/pr/${SLUG}/${NUMBER}`)
      .expect(200);
    const files = (response.body as ReviewBody).data.files;

    const changeTypeOf = (path: string) =>
      files.find((file) => file.path === path)?.changeType;

    expect(changeTypeOf("deliverables/appendix.md")).toBe("added");
    expect(changeTypeOf("deliverables/old-memo.md")).toBe("deleted");
    expect(changeTypeOf("deliverables/memo.docx")).toBe("modified");
  });

  it("yields a download payload with a link for the unrenderable format (never dropped)", async () => {
    app = await buildApp(stagedFake());
    await reconcileReview(app, `/pr/${SLUG}/${NUMBER}`);

    const response = await request(app.getHttpServer())
      .get(`/pr/${SLUG}/${NUMBER}`)
      .expect(200);
    const files = (response.body as ReviewBody).data.files;

    const xlsx = files.find((file) => file.path === "data/model.xlsx");
    expect(xlsx?.payload.format).toBe("download");
    expect(xlsx?.payload.filename).toBe("model.xlsx");
    expect(xlsx?.payload.blobUrl).toBe(
      `/pr/${SLUG}/${NUMBER}/raw?path=data%2Fmodel.xlsx`,
    );

    // Each file resolves to its own format's payload; the unrenderable xlsx still
    // falls to download, so none is dropped. (#8 md, #9 docx, #10 html + pdf now own
    // their arms; only formats with no dedicated renderer fall to download.)
    for (const file of files) {
      if (file.path.endsWith(".md")) {
        expect(file.payload.format).toBe("md");
        continue;
      }
      if (file.path.endsWith(".docx")) {
        expect(file.payload.format).toBe("docx");
        continue;
      }
      if (file.path.endsWith(".html")) {
        expect(file.payload.format).toBe("html");
        continue;
      }
      if (file.path.endsWith(".pdf")) {
        expect(file.payload.format).toBe("pdf");
        continue;
      }
      expect(file.payload.format).toBe("download");
      expect(file.payload.blobUrl).toBeTruthy();
    }
  });

  it("carries an open-on-GitHub deep link resolving to the PR's GitHub URL", async () => {
    app = await buildApp(stagedFake());
    await reconcileReview(app, `/pr/${SLUG}/${NUMBER}`);

    const response = await request(app.getHttpServer())
      .get(`/pr/${SLUG}/${NUMBER}`)
      .expect(200);

    expect((response.body as ReviewBody).data.githubUrl).toBe(
      `https://github.com/${SLUG}/pull/${NUMBER}`,
    );
  });
});

describe("POST /pr/:owner/:repo/:number/comments (feedback seam)", () => {
  let app: INestApplication | undefined;
  let fetchSpy: jest.SpyInstance;

  const fixture = REVIEW_LOOP;
  const route = `/pr/${fixture.owner}/${fixture.repo}/${fixture.number}`;
  const cases: [string, FeedbackAnchor][] = [
    [
      "Mirror range",
      {
        scope: "range",
        path: fixture.mirrorPath,
        startLine: 3,
        endLine: 4,
        quote:
          "The Quillibrium result is ready.\nKeep this exact second range line.",
        body: "MirrorBodyOnly-38",
      },
    ],
    [
      "Canonical section-plus-quote",
      {
        scope: "file",
        path: fixture.canonicalPath,
        locator: {
          section: "Recommendation",
          quote: "Exact nearby canonical Quasartext.",
        },
        body: "CanonicalBodyOnly-38",
      },
    ],
    [
      "PDF file",
      {
        scope: "file",
        path: fixture.pdfPath,
        body: "PdfBodyOnly-38",
      },
    ],
    [
      "HTML source line",
      {
        scope: "line",
        path: fixture.htmlPath,
        line: 3,
        quote: "<body><p>Exact Spindlewick source line.</p></body>",
        body: "HtmlBodyOnly-38",
      },
    ],
    ["review level", { scope: "review", body: "ReviewBodyOnly-38" }],
  ];

  beforeEach(async () => {
    fetchSpy = jest
      .spyOn(global, "fetch")
      .mockRejectedValue(new Error("No outbound fetch allowed"));
    app = await buildApp(stageReviewLoop());
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    fetchSpy.mockRestore();
  });

  it.each(cases)(
    "retains %s feedback with server-owned keys",
    async (_name, anchor) => {
      const response = await request(app!.getHttpServer())
        .post(`${route}/comments`)
        .send(anchor)
        .expect(201);

      const comment = reviewCommentSchema.parse(
        (response.body as { data: unknown }).data,
      );
      expect(comment).toMatchObject(anchor);
      expect(comment.id).toEqual(expect.any(String));
      expect(comment.createdAt).toEqual(expect.any(String));
      expect(comment.headSha).toBe(fixture.headSha);
      expect(comment.roundNumber).toBe(1);

      const surface = await request(app!.getHttpServer())
        .get(route)
        .expect(200);
      const parsed = reviewSurfaceResponseSchema.parse(
        (surface.body as { data: unknown }).data,
      );
      expect(parsed.currentRound.comments).toContainEqual(comment);
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      "a Mirror quote that does not match the addressed head lines",
      {
        scope: "range",
        path: fixture.mirrorPath,
        startLine: 3,
        endLine: 4,
        quote: "Not the addressed lines",
        body: "Invalid",
      },
    ],
    [
      "a Mirror range beyond the head",
      {
        scope: "range",
        path: fixture.mirrorPath,
        startLine: 999,
        endLine: 999,
        quote: "",
        body: "Invalid",
      },
    ],
    [
      "an HTML quote that does not match the addressed head line",
      {
        scope: "line",
        path: fixture.htmlPath,
        line: 3,
        quote: "<p>Not this line</p>",
        body: "Invalid",
      },
    ],
    [
      "a page-number-only Canonical locator",
      {
        scope: "file",
        path: fixture.canonicalPath,
        locator: { page: 2 },
        body: "Invalid",
      },
    ],
    [
      "a rendered DOCX line anchor",
      {
        scope: "line",
        path: fixture.canonicalPath,
        line: 1,
        quote: "Rendered text",
        body: "Invalid",
      },
    ],
    [
      "a rendered PDF line anchor",
      {
        scope: "line",
        path: fixture.pdfPath,
        line: 1,
        quote: "Rendered text",
        body: "Invalid",
      },
    ],
    [
      "an anchor outside the changed-document set",
      {
        scope: "file",
        path: "deliverables/not-changed.pdf",
        body: "Invalid",
      },
    ],
    [
      "review feedback carrying a path",
      {
        scope: "review",
        path: fixture.mirrorPath,
        body: "Invalid",
      },
    ],
    [
      "caller-supplied server keys",
      {
        scope: "review",
        body: "Invalid",
        id: "caller-id",
        headSha: "caller-sha",
        roundNumber: 99,
        createdAt: "2026-07-13T00:00:00.000Z",
      },
    ],
  ])("rejects %s", async (_name, anchor) => {
    await request(app!.getHttpServer())
      .post(`${route}/comments`)
      .send(anchor)
      .expect(400);
  });

  it("assigns a new round whenever the exact head changes, including a return to an earlier SHA", async () => {
    await app?.close();
    const fake = stageReviewLoop();
    app = await buildApp(fake);

    await reconcileReview(app, route);
    await request(app.getHttpServer()).get(route).expect(200);

    const nextHeadSha = "abcdefabcdefabcdefabcdefabcdefabcdefabcd";
    const slug = `${fixture.owner}/${fixture.repo}`;
    fake.setPullRequest(slug, reviewLoopMetadata(nextHeadSha));
    const nextCommentResponse = await request(app.getHttpServer())
      .post(`${route}/comments`)
      .send({ scope: "review", body: "SecondRoundOnly-38" })
      .expect(201);
    const nextComment = reviewCommentSchema.parse(
      (nextCommentResponse.body as { data: unknown }).data,
    );
    expect(nextComment.headSha).toBe(nextHeadSha);
    expect(nextComment.roundNumber).toBe(2);

    fake.setPullRequest(slug, reviewLoopMetadata());
    await reconcileReview(app, route);
    const retained = await request(app.getHttpServer()).get(route).expect(200);
    const parsed = reviewSurfaceResponseSchema.parse(
      (retained.body as { data: unknown }).data,
    );
    expect(parsed.currentRound).toMatchObject({
      number: 3,
      headSha: fixture.headSha,
      comments: [
        {
          id: nextComment.id,
          headSha: fixture.headSha,
          roundNumber: 3,
          carriedForward: true,
          drifted: false,
        },
      ],
    });
    expect(parsed.rounds.map((round) => round.headSha)).toEqual([
      fixture.headSha,
      nextHeadSha,
      fixture.headSha,
    ]);
  });

  it("retains a round after the application closes and restarts", async () => {
    const restartStatePath = join(
      tmpdir(),
      `doc-review-restart-${process.pid}-${randomUUID()}.json`,
    );
    await app?.close();
    app = await buildApp(stageReviewLoop(), restartStatePath);

    const created = await request(app.getHttpServer())
      .post(`${route}/comments`)
      .send({ scope: "review", body: "SurvivesRestartOnly-38" })
      .expect(201);
    const createdComment = reviewCommentSchema.parse(
      (created.body as { data: unknown }).data,
    );

    await app.close();
    app = await buildApp(stageReviewLoop(), restartStatePath);

    const surface = await request(app.getHttpServer()).get(route).expect(200);
    const parsed = reviewSurfaceResponseSchema.parse(
      (surface.body as { data: unknown }).data,
    );
    expect(parsed.currentRound.headSha).toBe(fixture.headSha);
    expect(parsed.currentRound.comments).toContainEqual(createdComment);
  });
});

// The #63 gate (AC3/AC4): a rendered-text Mirror selector is accepted only when its
// position hints address the exact submitted quote in the authoritative review-text
// reproduced from the exact head; an accepted comment persists across restart and
// appears unchanged in the finished artifact, carrying its originating head and
// selector evidence. Runs with outbound `fetch` planted to throw (no GitHub).
describe("POST /pr/:owner/:repo/:number/comments (rendered-text Mirror feedback)", () => {
  let app: INestApplication | undefined;
  let fetchSpy: jest.SpyInstance;

  const fixture = REVIEW_LOOP;
  const route = `/pr/${fixture.owner}/${fixture.repo}/${fixture.number}`;
  const pr = `${fixture.owner}/${fixture.repo}#${fixture.number}`;

  // The authoritative review-text the server reproduces from the fixture's exact head,
  // and a selector addressing a real span of it. Offsets are derived from the same
  // normalizer the server validates with, so the hints address the quote exactly.
  const reviewText = normalizeMirrorReviewText(fixture.mirrorHead);
  const QUOTE = "Quillibrium result";
  const START = reviewText.indexOf(QUOTE);
  const END = START + QUOTE.length;
  const PREFIX = reviewText.slice(Math.max(0, START - 4), START);
  const SUFFIX = reviewText.slice(END, END + 12);
  const renderedAnchor: FeedbackAnchor = {
    scope: "rendered",
    format: "md",
    path: fixture.mirrorPath,
    quote: QUOTE,
    prefix: PREFIX,
    suffix: SUFFIX,
    start: START,
    end: END,
    selectorVersion: 1,
    body: "RenderedBodyOnly-63",
  };

  beforeEach(async () => {
    fetchSpy = jest
      .spyOn(global, "fetch")
      .mockRejectedValue(new Error("No outbound fetch allowed"));
    app = await buildApp(stageReviewLoop());
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    fetchSpy.mockRestore();
  });

  it("accepts a matching selector and retains it with server-owned keys", async () => {
    const response = await request(app!.getHttpServer())
      .post(`${route}/comments`)
      .send(renderedAnchor)
      .expect(201);

    const comment = reviewCommentSchema.parse(
      (response.body as { data: unknown }).data,
    );
    expect(comment).toMatchObject(renderedAnchor);
    expect(comment.headSha).toBe(fixture.headSha);
    expect(comment.roundNumber).toBe(1);

    const surface = await request(app!.getHttpServer()).get(route).expect(200);
    const parsed = reviewSurfaceResponseSchema.parse(
      (surface.body as { data: unknown }).data,
    );
    expect(parsed.currentRound.comments).toContainEqual(comment);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a quote that does not match the addressed review-text span",
      {
        scope: "rendered",
        format: "md",
        path: fixture.mirrorPath,
        quote: "Not the review-text at this span",
        prefix: PREFIX,
        suffix: SUFFIX,
        start: START,
        end: END,
        selectorVersion: 1,
        body: "Invalid",
      },
    ],
    [
      "a prefix that does not immediately precede the addressed span",
      {
        scope: "rendered",
        format: "md",
        path: fixture.mirrorPath,
        quote: QUOTE,
        prefix: "Not the preceding context",
        suffix: SUFFIX,
        start: START,
        end: END,
        selectorVersion: 1,
        body: "Invalid",
      },
    ],
    [
      "a suffix that does not immediately follow the addressed span",
      {
        scope: "rendered",
        format: "md",
        path: fixture.mirrorPath,
        quote: QUOTE,
        prefix: PREFIX,
        suffix: "Not the following context",
        start: START,
        end: END,
        selectorVersion: 1,
        body: "Invalid",
      },
    ],
    [
      "an empty prefix on a mid-document span (empty prefix is a document-start claim only)",
      {
        scope: "rendered",
        format: "md",
        path: fixture.mirrorPath,
        quote: QUOTE,
        prefix: "",
        suffix: SUFFIX,
        start: START,
        end: END,
        selectorVersion: 1,
        body: "Invalid",
      },
    ],
    [
      "an empty suffix on a mid-document span (empty suffix is a document-end claim only)",
      {
        scope: "rendered",
        format: "md",
        path: fixture.mirrorPath,
        quote: QUOTE,
        prefix: PREFIX,
        suffix: "",
        start: START,
        end: END,
        selectorVersion: 1,
        body: "Invalid",
      },
    ],
    [
      "a range beyond the review-text",
      {
        scope: "rendered",
        format: "md",
        path: fixture.mirrorPath,
        quote: "beyond",
        prefix: "",
        suffix: "",
        start: 0,
        end: reviewText.length + 25,
        selectorVersion: 1,
        body: "Invalid",
      },
    ],
    [
      "a reversed range",
      {
        scope: "rendered",
        format: "md",
        path: fixture.mirrorPath,
        quote: "reversed",
        prefix: "",
        suffix: "",
        start: 20,
        end: 5,
        selectorVersion: 1,
        body: "Invalid",
      },
    ],
    [
      "an unsupported selector version",
      {
        scope: "rendered",
        format: "md",
        path: fixture.mirrorPath,
        quote: QUOTE,
        prefix: PREFIX,
        suffix: SUFFIX,
        start: START,
        end: END,
        selectorVersion: 2,
        body: "Invalid",
      },
    ],
    [
      "a Mirror-format selector on a non-Mirror (pdf) path",
      {
        scope: "rendered",
        format: "md",
        path: fixture.pdfPath,
        quote: QUOTE,
        prefix: PREFIX,
        suffix: SUFFIX,
        start: START,
        end: END,
        selectorVersion: 1,
        body: "Invalid",
      },
    ],
    [
      "a Mirror-format selector with an HTML path (format/path mismatch)",
      {
        scope: "rendered",
        format: "md",
        path: fixture.htmlPath,
        quote: QUOTE,
        prefix: PREFIX,
        suffix: SUFFIX,
        start: START,
        end: END,
        selectorVersion: 1,
        body: "Invalid",
      },
    ],
    [
      "a valid .md path that is not in the changed set",
      {
        scope: "rendered",
        format: "md",
        path: "deliverables/not-a-changed-file.md",
        quote: QUOTE,
        prefix: PREFIX,
        suffix: SUFFIX,
        start: START,
        end: END,
        selectorVersion: 1,
        body: "Invalid",
      },
    ],
    [
      "a missing path",
      {
        scope: "rendered",
        format: "md",
        quote: QUOTE,
        prefix: PREFIX,
        suffix: SUFFIX,
        start: START,
        end: END,
        selectorVersion: 1,
        body: "Invalid",
      },
    ],
    [
      "a missing format",
      {
        scope: "rendered",
        path: fixture.mirrorPath,
        quote: QUOTE,
        prefix: PREFIX,
        suffix: SUFFIX,
        start: START,
        end: END,
        selectorVersion: 1,
        body: "Invalid",
      },
    ],
  ])("rejects %s", async (_name, anchor) => {
    await request(app!.getHttpServer())
      .post(`${route}/comments`)
      .send(anchor)
      .expect(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a selector on a deleted Mirror", async () => {
    await app?.close();
    const fake = stageReviewLoop();
    fake.setChangedFiles(`${fixture.owner}/${fixture.repo}`, fixture.number, [
      { path: fixture.mirrorPath, status: "removed" },
      { path: fixture.canonicalPath, status: "modified" },
      { path: fixture.htmlPath, status: "modified" },
      { path: fixture.pdfPath, status: "modified" },
    ]);
    app = await buildApp(fake);

    await request(app.getHttpServer())
      .post(`${route}/comments`)
      .send(renderedAnchor)
      .expect(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("survives restart and appears unchanged in the finished artifact", async () => {
    const restartStatePath = join(
      tmpdir(),
      `doc-review-rendered-${process.pid}-${randomUUID()}.json`,
    );
    await app?.close();
    app = await buildApp(stageReviewLoop(), restartStatePath);

    const created = await request(app.getHttpServer())
      .post(`${route}/comments`)
      .send(renderedAnchor)
      .expect(201);
    const createdComment = reviewCommentSchema.parse(
      (created.body as { data: unknown }).data,
    );

    // Restart: the durable state is reloaded from disk into a fresh application.
    await app.close();
    app = await buildApp(stageReviewLoop(), restartStatePath);

    const surface = await request(app.getHttpServer()).get(route).expect(200);
    const parsed = reviewSurfaceResponseSchema.parse(
      (surface.body as { data: unknown }).data,
    );
    const survived = parsed.currentRound.comments.find(
      (entry) => entry.id === createdComment.id,
    );
    expect(survived).toEqual(createdComment);
    expect(survived).toMatchObject({
      scope: "rendered",
      format: "md",
      path: fixture.mirrorPath,
      quote: QUOTE,
      start: START,
      end: END,
      selectorVersion: 1,
      headSha: fixture.headSha,
    });

    // The finished artifact carries the comment unchanged, with no resolution surface.
    const finished = await request(app.getHttpServer())
      .patch(`${route}/review/current`)
      .send({ status: "finished" })
      .expect(200);
    const artifact = reviewArtifactSchema.parse(
      (finished.body as { data: unknown }).data,
    );
    expect(artifact.pr).toBe(pr);
    expect(artifact.headSha).toBe(fixture.headSha);
    const inArtifact = artifact.comments.find(
      (entry) => entry.id === createdComment.id,
    );
    expect(inArtifact).toMatchObject({
      scope: "rendered",
      format: "md",
      path: fixture.mirrorPath,
      quote: QUOTE,
      prefix: PREFIX,
      suffix: SUFFIX,
      start: START,
      end: END,
      selectorVersion: 1,
      headSha: fixture.headSha,
      body: "RenderedBodyOnly-63",
    });
    expect(inArtifact && "resolved" in inArtifact).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// #66: the rendered-text HTML anchor lifecycle, the HTML analogue of the rendered-text
// Mirror describe above. The sanitized HTML copy joins the SAME shared rendered-text
// selector, validation seam, and durable feedback lifecycle. Outbound `fetch` is planted
// to throw so no external content or comment request escapes the local doc-review API (AC7).
describe("POST /pr/:owner/:repo/:number/comments (rendered-text HTML feedback)", () => {
  let app: INestApplication | undefined;
  let fetchSpy: jest.SpyInstance;

  const fixture = REVIEW_LOOP;
  const slug = `${fixture.owner}/${fixture.repo}`;
  const route = `/pr/${slug}/${fixture.number}`;
  const pr = `${slug}#${fixture.number}`;

  // Paired counter-fixture (criterion 1): identical RAW and EXPECTED normalized sequence
  // to the mounted-DOM HTML annotation test in
  // apps/client/src/pages/ReviewSurfaceView.html.dom.test.tsx. The sentinels are
  // discriminating: a source-order or raw-markup normalization would leak the
  // script/style bodies, merge the block joins, drop the image alt, or keep raw tags.
  const HTML_RAW =
    "<style>.secret{color:red}STYLE_BODY_SENTINEL</style>" +
    '<h2 style="color:red">Zephyr overview section.</h2>' +
    "<p>The Bandersnatch metric holds firm across revisions.</p>" +
    "<script>window.__x = 'SCRIPT_BODY_SENTINEL';</script>" +
    '<p onclick="window.__x=1">Second   paragraph   about scope.</p>' +
    "<details><summary>Disclosure summary control.</summary>" +
    "<p>Disclosure body stays readable.</p></details>" +
    '<img src="https://tracker.example/pixel.png" alt="Gamma pixel caption.">' +
    '<p><a href="https://tracker.example/out">External link label.</a></p>';
  const EXPECTED_NORMALIZED =
    "Zephyr overview section. " +
    "The Bandersnatch metric holds firm across revisions. " +
    "Second paragraph about scope. " +
    "Disclosure summary control. " +
    "Disclosure body stays readable. " +
    "Gamma pixel caption. " +
    "External link label.";
  const normalizeWhitespace = (value: string): string =>
    value.replace(/\s+/g, " ").trim();

  const reviewText = normalizeHtmlReviewText(HTML_RAW);
  const QUOTE = "The Bandersnatch metric holds firm across revisions.";
  const START = reviewText.indexOf(QUOTE);
  const END = START + QUOTE.length;
  const PREFIX = reviewText.slice(Math.max(0, START - 12), START);
  const SUFFIX = reviewText.slice(END, END + 12);
  const htmlAnchor: FeedbackAnchor = {
    scope: "rendered",
    format: "html",
    path: fixture.htmlPath,
    quote: QUOTE,
    prefix: PREFIX,
    suffix: SUFFIX,
    start: START,
    end: END,
    selectorVersion: 1,
    body: "RenderedHtmlBody-66",
  };

  // Stages the review loop, then overrides the HTML head at every ref with the rich
  // counter-fixture so both the shipped payload review-text and the validation seam
  // reproduce it from the exact head.
  const stageHtml = (): FakeGitHubSource => {
    const fake = stageReviewLoop();
    for (const ref of [fixture.branch, fixture.headSha]) {
      fake.setBlob(slug, ref, {
        path: fixture.htmlPath,
        ref,
        bytes: Buffer.from(HTML_RAW, "utf8"),
      });
    }
    return fake;
  };

  beforeEach(async () => {
    fetchSpy = jest
      .spyOn(global, "fetch")
      .mockRejectedValue(new Error("No outbound fetch allowed"));
    app = await buildApp(stageHtml());
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    fetchSpy.mockRestore();
  });

  it("reproduces the same deterministic safe-text sequence the sanitized DOM extracts, and ships it on the payload", async () => {
    // The server validation seam and the shipped payload reproduce the same normalized
    // safe-text; the mounted-DOM sibling test proves the sanitized application DOM
    // extracts this same sequence.
    expect(normalizeWhitespace(reviewText)).toBe(EXPECTED_NORMALIZED);
    // Discriminating sentinels: script/style BODIES dropped, blocks joined not merged,
    // image alt kept, raw markup absent.
    expect(reviewText).not.toContain("SCRIPT_BODY_SENTINEL");
    expect(reviewText).not.toContain("STYLE_BODY_SENTINEL");
    expect(reviewText).not.toContain("<");
    expect(reviewText).toContain("Gamma pixel caption.");
    expect(normalizeWhitespace(reviewText)).not.toContain(
      "section.The Bandersnatch",
    );

    await reconcileReview(app!, route);
    const surface = await request(app!.getHttpServer()).get(route).expect(200);
    const parsed = reviewSurfaceResponseSchema.parse(
      (surface.body as { data: unknown }).data,
    );
    const htmlPayload = parsed.files.find(
      (file) => file.path === fixture.htmlPath,
    )?.payload;
    expect(htmlPayload?.format).toBe("html");
    expect(
      htmlPayload && "reviewText" in htmlPayload
        ? htmlPayload.reviewText
        : undefined,
    ).toBe(reviewText);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("accepts a matching HTML selector against the authoritative safe text", async () => {
    const response = await request(app!.getHttpServer())
      .post(`${route}/comments`)
      .send(htmlAnchor)
      .expect(201);

    const comment = reviewCommentSchema.parse(
      (response.body as { data: unknown }).data,
    );
    expect(comment).toMatchObject(htmlAnchor);
    expect(comment.headSha).toBe(fixture.headSha);
    expect(comment.roundNumber).toBe(1);

    const surface = await request(app!.getHttpServer()).get(route).expect(200);
    const parsed = reviewSurfaceResponseSchema.parse(
      (surface.body as { data: unknown }).data,
    );
    expect(parsed.currentRound.comments).toContainEqual(comment);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a quote that does not match the addressed safe-text span",
      { ...htmlAnchor, quote: "Not the safe text at this span" },
    ],
    [
      "a raw-markup offset instead of the normalized safe text",
      {
        ...htmlAnchor,
        quote: "<p>The Bandersnatch metric holds firm across revisions.</p>",
      },
    ],
    [
      "a prefix that does not immediately precede the addressed span",
      { ...htmlAnchor, prefix: "Not the preceding context" },
    ],
    [
      "a suffix that does not immediately follow the addressed span",
      { ...htmlAnchor, suffix: "Not the following context" },
    ],
    [
      "an empty prefix on a mid-document span (empty prefix is a document-start claim only)",
      { ...htmlAnchor, prefix: "" },
    ],
    [
      "an empty suffix on a mid-document span (empty suffix is a document-end claim only)",
      { ...htmlAnchor, suffix: "" },
    ],
    [
      "a range beyond the safe text",
      {
        ...htmlAnchor,
        quote: "beyond",
        prefix: "",
        suffix: "",
        start: 0,
        end: reviewText.length + 25,
      },
    ],
    [
      "a reversed range",
      {
        ...htmlAnchor,
        quote: "reversed",
        prefix: "",
        suffix: "",
        start: 20,
        end: 5,
      },
    ],
    ["an unsupported selector version", { ...htmlAnchor, selectorVersion: 2 }],
    ["a non-rendered path (pdf)", { ...htmlAnchor, path: fixture.pdfPath }],
    [
      "a Canonical (.docx) path, not a rendered-text document",
      { ...htmlAnchor, path: fixture.canonicalPath },
    ],
    [
      "an HTML-format selector with a Mirror (.md) path (format/path mismatch)",
      { ...htmlAnchor, path: fixture.mirrorPath },
    ],
    [
      "a valid .html path that is not in the changed set",
      { ...htmlAnchor, path: "sources/not-a-changed-file.html" },
    ],
    ["a missing path", { ...htmlAnchor, path: undefined }],
    ["a missing format", { ...htmlAnchor, format: undefined }],
  ])("rejects %s", async (_name, anchor) => {
    await request(app!.getHttpServer())
      .post(`${route}/comments`)
      .send(anchor)
      .expect(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a selector on a deleted HTML document", async () => {
    await app?.close();
    const fake = stageHtml();
    fake.setChangedFiles(slug, fixture.number, [
      { path: fixture.mirrorPath, status: "modified" },
      { path: fixture.canonicalPath, status: "modified" },
      { path: fixture.htmlPath, status: "removed" },
      { path: fixture.pdfPath, status: "modified" },
    ]);
    app = await buildApp(fake);

    await request(app.getHttpServer())
      .post(`${route}/comments`)
      .send(htmlAnchor)
      .expect(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("carries the submitted HTML selector and originating head into the finished artifact without browser-only state", async () => {
    const created = await request(app!.getHttpServer())
      .post(`${route}/comments`)
      .send(htmlAnchor)
      .expect(201);
    const createdComment = reviewCommentSchema.parse(
      (created.body as { data: unknown }).data,
    );

    const finished = await request(app!.getHttpServer())
      .patch(`${route}/review/current`)
      .send({ status: "finished" })
      .expect(200);
    const artifact = reviewArtifactSchema.parse(
      (finished.body as { data: unknown }).data,
    );
    expect(artifact.pr).toBe(pr);
    expect(artifact.headSha).toBe(fixture.headSha);

    const inArtifact = artifact.comments.find(
      (entry) => entry.id === createdComment.id,
    );
    expect(inArtifact).toMatchObject({
      scope: "rendered",
      format: "html",
      path: fixture.htmlPath,
      quote: QUOTE,
      prefix: PREFIX,
      suffix: SUFFIX,
      start: START,
      end: END,
      selectorVersion: 1,
      headSha: fixture.headSha,
      body: "RenderedHtmlBody-66",
    });
    // No browser-only annotation state (a persisted Recogito target) and no resolution
    // surface rode into the frozen artifact.
    expect(inArtifact && "resolved" in inArtifact).toBe(false);
    expect(inArtifact && "target" in inArtifact).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("survives a storage restart and appears unchanged in the finished artifact", async () => {
    const restartStatePath = join(
      tmpdir(),
      `doc-review-rendered-html-${process.pid}-${randomUUID()}.json`,
    );
    await app?.close();
    app = await buildApp(stageHtml(), restartStatePath);

    const created = await request(app.getHttpServer())
      .post(`${route}/comments`)
      .send(htmlAnchor)
      .expect(201);
    const createdComment = reviewCommentSchema.parse(
      (created.body as { data: unknown }).data,
    );

    // Restart: the durable state is reloaded from disk into a fresh application, and the
    // fake head is re-staged so the reproduced review-text still validates.
    await app.close();
    app = await buildApp(stageHtml(), restartStatePath);

    const surface = await request(app.getHttpServer()).get(route).expect(200);
    const parsed = reviewSurfaceResponseSchema.parse(
      (surface.body as { data: unknown }).data,
    );
    const survived = parsed.currentRound.comments.find(
      (entry) => entry.id === createdComment.id,
    );
    expect(survived).toEqual(createdComment);
    expect(survived).toMatchObject({
      scope: "rendered",
      format: "html",
      path: fixture.htmlPath,
      quote: QUOTE,
      start: START,
      end: END,
      selectorVersion: 1,
      headSha: fixture.headSha,
    });

    // The finished artifact carries the HTML selector unchanged, with no resolution
    // surface and no browser-only state.
    const finished = await request(app.getHttpServer())
      .patch(`${route}/review/current`)
      .send({ status: "finished" })
      .expect(200);
    const artifact = reviewArtifactSchema.parse(
      (finished.body as { data: unknown }).data,
    );
    const inArtifact = artifact.comments.find(
      (entry) => entry.id === createdComment.id,
    );
    expect(inArtifact).toMatchObject({
      scope: "rendered",
      format: "html",
      path: fixture.htmlPath,
      quote: QUOTE,
      prefix: PREFIX,
      suffix: SUFFIX,
      start: START,
      end: END,
      selectorVersion: 1,
      headSha: fixture.headSha,
      body: "RenderedHtmlBody-66",
    });
    expect(inArtifact && "resolved" in inArtifact).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// The #67 gate: rendered-text Canonical feedback. A Canonical (.docx) uses the SAME
// selector contract and validation seam as the Mirror (#63) and HTML (#66); the server
// converts the head docx to HTML with mammoth and flattens THAT with the same block-aware
// tokenizer the HTML arm uses, so the review-text the client's mounted mammoth-HTML DOM
// extracts and the text the server reproduces to validate agree by construction. Every case
// runs with outbound `fetch` planted to throw and uses only the FakeGitHubSource: no GitHub
// or third-party call occurs on the review plane.
describe("POST /pr/:owner/:repo/:number/comments (rendered-text Canonical feedback)", () => {
  let app: INestApplication | undefined;
  let fetchSpy: jest.SpyInstance;

  const fixture = REVIEW_LOOP;
  const slug = `${fixture.owner}/${fixture.repo}`;
  const route = `/pr/${slug}/${fixture.number}`;
  const pr = `${slug}#${fixture.number}`;

  // The rich Canonical counter-fixture's authoritative normalized review-text (criterion
  // 1): the exact string the server reproduces from `buildRichCanonicalDocx()`. The
  // discriminating structure - heading and paragraph joined (not merged), a split run kept
  // contiguous within its paragraph, a preserved run of collapsible whitespace, and two
  // table cells joined with a boundary - is mirrored in the mounted-DOM sibling test in
  // apps/client/src/pages/ReviewSurfaceView.canonical.dom.test.tsx (CANONICAL_REVIEW_TEXT).
  // The reproduction test below asserts the live server produces this string exactly, so
  // this hard-coded copy cannot silently drift from the tokenizer.
  const CANONICAL_REVIEW_TEXT =
    "Zephyr canonical overview.\n" +
    "The Bandersnatch metric holds firm across revisions.\n" +
    "Second paragraph about canonical scope.\n" +
    "Spaced    canonical    words.\n" +
    "Alpha canonical cell.\n" +
    "Beta canonical cell.";
  const EXPECTED_NORMALIZED =
    "Zephyr canonical overview. " +
    "The Bandersnatch metric holds firm across revisions. " +
    "Second paragraph about canonical scope. " +
    "Spaced canonical words. " +
    "Alpha canonical cell. " +
    "Beta canonical cell.";
  const normalizeWhitespace = (value: string): string =>
    value.replace(/\s+/g, " ").trim();

  const QUOTE = "The Bandersnatch metric holds firm across revisions.";
  const START = CANONICAL_REVIEW_TEXT.indexOf(QUOTE);
  const END = START + QUOTE.length;
  const PREFIX = CANONICAL_REVIEW_TEXT.slice(Math.max(0, START - 12), START);
  const SUFFIX = CANONICAL_REVIEW_TEXT.slice(END, END + 12);
  const docxAnchor: FeedbackAnchor = {
    scope: "rendered",
    format: "docx",
    path: fixture.canonicalPath,
    quote: QUOTE,
    prefix: PREFIX,
    suffix: SUFFIX,
    start: START,
    end: END,
    selectorVersion: 1,
    body: "RenderedCanonicalBody-67",
  };

  // Stages the review loop, then overrides the Canonical head at every ref with the rich
  // counter-fixture docx, so both the shipped payload review-text and the validation seam
  // reproduce it from the exact head.
  const stageCanonical = (): FakeGitHubSource => {
    const fake = stageReviewLoop();
    for (const ref of [fixture.branch, fixture.headSha]) {
      fake.setBlob(slug, ref, {
        path: fixture.canonicalPath,
        ref,
        bytes: buildRichCanonicalDocx(),
      });
    }
    return fake;
  };

  beforeEach(async () => {
    fetchSpy = jest
      .spyOn(global, "fetch")
      .mockRejectedValue(new Error("No outbound fetch allowed"));
    app = await buildApp(stageCanonical());
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    fetchSpy.mockRestore();
  });

  it("reproduces the same deterministic mammoth-HTML review-text the rendered DOM extracts, and ships it on the payload (criterion 1)", async () => {
    await reconcileReview(app!, route);
    const surface = await request(app!.getHttpServer()).get(route).expect(200);
    const parsed = reviewSurfaceResponseSchema.parse(
      (surface.body as { data: unknown }).data,
    );
    const canonicalPayload = parsed.files.find(
      (file) => file.path === fixture.canonicalPath,
    )?.payload;
    expect(canonicalPayload?.format).toBe("docx");
    const reviewText =
      canonicalPayload && "reviewText" in canonicalPayload
        ? canonicalPayload.reviewText
        : "";

    // The live server produces the exact hard-coded review-text (so the sibling mounted-DOM
    // fixture is a genuine pair), and it normalizes to the discriminating sequence.
    expect(reviewText).toBe(CANONICAL_REVIEW_TEXT);
    expect(normalizeWhitespace(reviewText)).toBe(EXPECTED_NORMALIZED);
    // Discriminating sentinels: the heading and first paragraph are joined by a boundary,
    // not merged; the split run stays contiguous; the table cells are joined, not merged;
    // and no raw markup leaks.
    expect(reviewText).not.toContain("<");
    expect(normalizeWhitespace(reviewText)).not.toContain(
      "overview.The Bandersnatch",
    );
    expect(reviewText).toContain("Second paragraph about canonical scope.");
    expect(normalizeWhitespace(reviewText)).not.toContain(
      "cell.Beta canonical",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("accepts a matching Canonical selector against the authoritative rendered head (criterion 3)", async () => {
    const response = await request(app!.getHttpServer())
      .post(`${route}/comments`)
      .send(docxAnchor)
      .expect(201);

    const comment = reviewCommentSchema.parse(
      (response.body as { data: unknown }).data,
    );
    expect(comment).toMatchObject(docxAnchor);
    expect(comment.headSha).toBe(fixture.headSha);
    expect(comment.roundNumber).toBe(1);

    const surface = await request(app!.getHttpServer()).get(route).expect(200);
    const parsed = reviewSurfaceResponseSchema.parse(
      (surface.body as { data: unknown }).data,
    );
    expect(parsed.currentRound.comments).toContainEqual(comment);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a quote that does not match the addressed rendered span",
      { ...docxAnchor, quote: "Not the rendered text at this span" },
    ],
    [
      "a raw-markup offset instead of the normalized rendered text",
      {
        ...docxAnchor,
        quote: "<p>The Bandersnatch metric holds firm across revisions.</p>",
      },
    ],
    [
      "a prefix that does not immediately precede the addressed span",
      { ...docxAnchor, prefix: "Not the preceding context" },
    ],
    [
      "a suffix that does not immediately follow the addressed span",
      { ...docxAnchor, suffix: "Not the following context" },
    ],
    [
      "an empty prefix on a mid-document span (empty prefix is a document-start claim only)",
      { ...docxAnchor, prefix: "" },
    ],
    [
      "an empty suffix on a mid-document span (empty suffix is a document-end claim only)",
      { ...docxAnchor, suffix: "" },
    ],
    [
      "a range beyond the rendered text",
      {
        ...docxAnchor,
        quote: "beyond",
        prefix: "",
        suffix: "",
        start: 0,
        end: CANONICAL_REVIEW_TEXT.length + 25,
      },
    ],
    [
      "a reversed range",
      {
        ...docxAnchor,
        quote: "reversed",
        prefix: "",
        suffix: "",
        start: 20,
        end: 5,
      },
    ],
    ["an unsupported selector version", { ...docxAnchor, selectorVersion: 2 }],
    ["a non-rendered path (pdf)", { ...docxAnchor, path: fixture.pdfPath }],
    [
      "a docx-format selector with a Mirror (.md) path (format/path mismatch)",
      { ...docxAnchor, path: fixture.mirrorPath },
    ],
    [
      "a docx-format selector with an HTML (.htm) path (format/path mismatch)",
      { ...docxAnchor, path: fixture.htmlPath },
    ],
    [
      "a valid .docx path that is not in the changed set",
      { ...docxAnchor, path: "deliverables/not-a-changed-file.docx" },
    ],
    ["a missing path", { ...docxAnchor, path: undefined }],
    ["a missing format", { ...docxAnchor, format: undefined }],
  ])("rejects %s (criterion 3)", async (_name, anchor) => {
    await request(app!.getHttpServer())
      .post(`${route}/comments`)
      .send(anchor)
      .expect(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a selector on a deleted Canonical (criterion 3)", async () => {
    await app?.close();
    const fake = stageCanonical();
    fake.setChangedFiles(slug, fixture.number, [
      { path: fixture.mirrorPath, status: "modified" },
      { path: fixture.canonicalPath, status: "removed" },
      { path: fixture.htmlPath, status: "modified" },
      { path: fixture.pdfPath, status: "modified" },
    ]);
    app = await buildApp(fake);

    await request(app.getHttpServer())
      .post(`${route}/comments`)
      .send(docxAnchor)
      .expect(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("carries the submitted Canonical selector and originating head into the finished artifact without browser-only state (criterion 5)", async () => {
    const created = await request(app!.getHttpServer())
      .post(`${route}/comments`)
      .send(docxAnchor)
      .expect(201);
    const createdComment = reviewCommentSchema.parse(
      (created.body as { data: unknown }).data,
    );

    const finished = await request(app!.getHttpServer())
      .patch(`${route}/review/current`)
      .send({ status: "finished" })
      .expect(200);
    const artifact = reviewArtifactSchema.parse(
      (finished.body as { data: unknown }).data,
    );
    expect(artifact.pr).toBe(pr);
    expect(artifact.headSha).toBe(fixture.headSha);

    const inArtifact = artifact.comments.find(
      (entry) => entry.id === createdComment.id,
    );
    expect(inArtifact).toMatchObject({
      scope: "rendered",
      format: "docx",
      path: fixture.canonicalPath,
      quote: QUOTE,
      prefix: PREFIX,
      suffix: SUFFIX,
      start: START,
      end: END,
      selectorVersion: 1,
      headSha: fixture.headSha,
      body: "RenderedCanonicalBody-67",
    });
    // No browser-only annotation state (a persisted Recogito target) and no resolution
    // surface rode into the frozen artifact.
    expect(inArtifact && "resolved" in inArtifact).toBe(false);
    expect(inArtifact && "target" in inArtifact).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("survives a storage restart and appears unchanged in the finished artifact (criterion 5)", async () => {
    const restartStatePath = join(
      tmpdir(),
      `doc-review-rendered-docx-${process.pid}-${randomUUID()}.json`,
    );
    await app?.close();
    app = await buildApp(stageCanonical(), restartStatePath);

    const created = await request(app.getHttpServer())
      .post(`${route}/comments`)
      .send(docxAnchor)
      .expect(201);
    const createdComment = reviewCommentSchema.parse(
      (created.body as { data: unknown }).data,
    );

    // Restart: the durable state is reloaded from disk into a fresh application, and the
    // fake head is re-staged so the reproduced review-text still validates.
    await app.close();
    app = await buildApp(stageCanonical(), restartStatePath);

    const surface = await request(app.getHttpServer()).get(route).expect(200);
    const parsed = reviewSurfaceResponseSchema.parse(
      (surface.body as { data: unknown }).data,
    );
    const survived = parsed.currentRound.comments.find(
      (entry) => entry.id === createdComment.id,
    );
    expect(survived).toEqual(createdComment);
    expect(survived).toMatchObject({
      scope: "rendered",
      format: "docx",
      path: fixture.canonicalPath,
      quote: QUOTE,
      start: START,
      end: END,
      selectorVersion: 1,
      headSha: fixture.headSha,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// Regression for the shared rendered-text reproduction path (#67): `reproduceRenderedReviewText`
// now decodes the head BYTES to text before normalizing, so a multibyte head - accented Latin,
// CJK, an em dash, and an astral emoji (a UTF-16 surrogate pair) - must still yield a review-text
// whose offsets a submitted selector validates against. The anchor's quote/prefix/suffix are
// JS-string spans of that review-text, so the `Buffer -> utf8` decode must not shift them.
describe("POST /pr/:owner/:repo/:number/comments (rendered-text multibyte offsets)", () => {
  let app: INestApplication | undefined;
  let fetchSpy: jest.SpyInstance;

  const fixture = REVIEW_LOOP;
  const slug = `${fixture.owner}/${fixture.repo}`;
  const route = `/pr/${slug}/${fixture.number}`;

  const MULTIBYTE_HEAD = [
    "# 정본 문서 검토",
    "",
    "The Zangwill 불변식 holds - café built 🚀 across every revision.",
  ].join("\n");
  const reviewText = normalizeMirrorReviewText(MULTIBYTE_HEAD);
  const QUOTE =
    "The Zangwill 불변식 holds - café built 🚀 across every revision.";
  const START = reviewText.indexOf(QUOTE);
  const END = START + QUOTE.length;
  const multibyteAnchor: FeedbackAnchor = {
    scope: "rendered",
    format: "md",
    path: fixture.mirrorPath,
    quote: QUOTE,
    prefix: reviewText.slice(Math.max(0, START - 12), START),
    suffix: reviewText.slice(END, END + 12),
    start: START,
    end: END,
    selectorVersion: 1,
    body: "RenderedMultibyteBody-67",
  };

  const stageMultibyte = (): FakeGitHubSource => {
    const fake = stageReviewLoop();
    for (const ref of [fixture.branch, fixture.headSha]) {
      fake.setBlob(slug, ref, {
        path: fixture.mirrorPath,
        ref,
        bytes: Buffer.from(MULTIBYTE_HEAD, "utf8"),
      });
    }
    return fake;
  };

  beforeEach(async () => {
    fetchSpy = jest
      .spyOn(global, "fetch")
      .mockRejectedValue(new Error("No outbound fetch allowed"));
    app = await buildApp(stageMultibyte());
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    fetchSpy.mockRestore();
  });

  it("accepts a multibyte selector whose offsets address the reproduced review-text", async () => {
    // The quote genuinely carries astral and multibyte characters, so this is not a Latin-only
    // path: the astral emoji alone is two UTF-16 code units.
    expect(QUOTE).toContain("🚀");
    expect(reviewText.slice(START, END)).toBe(QUOTE);

    const response = await request(app!.getHttpServer())
      .post(`${route}/comments`)
      .send(multibyteAnchor)
      .expect(201);
    const comment = reviewCommentSchema.parse(
      (response.body as { data: unknown }).data,
    );
    expect(comment).toMatchObject(multibyteAnchor);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a multibyte selector whose range is shifted off the reproduced text", async () => {
    // Shifting the span by one code unit no longer addresses the quote in the reproduced
    // review-text, so the hint cannot vouch for it - a decode that mis-counted multibyte
    // characters would let this through.
    await request(app!.getHttpServer())
      .post(`${route}/comments`)
      .send({ ...multibyteAnchor, start: START + 1, end: END + 1 })
      .expect(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// The #39 gate: the reviewer-driven round state machine (finish / resolve / approve)
// through the existing review controller. Every case runs with outbound `fetch`
// planted to throw and uses only the FakeGitHubSource (AC8): no GitHub or third-party
// write occurs on the review plane.
describe("round state machine: finish / resolve / approve", () => {
  let app: INestApplication | undefined;
  let fetchSpy: jest.SpyInstance;

  const fixture = REVIEW_LOOP;
  const route = `/pr/${fixture.owner}/${fixture.repo}/${fixture.number}`;
  const pr = `${fixture.owner}/${fixture.repo}#${fixture.number}`;
  const RANGE_QUOTE =
    "The Quillibrium result is ready.\nKeep this exact second range line.";
  const rangeAnchor: FeedbackAnchor = {
    scope: "range",
    path: fixture.mirrorPath,
    startLine: 3,
    endLine: 4,
    quote: RANGE_QUOTE,
    body: "UnresolvedRange-39",
  };

  const postComment = async (anchor: FeedbackAnchor) => {
    const response = await request(app!.getHttpServer())
      .post(`${route}/comments`)
      .send(anchor)
      .expect(201);
    return reviewCommentSchema.parse((response.body as { data: unknown }).data);
  };

  beforeEach(async () => {
    fetchSpy = jest
      .spyOn(global, "fetch")
      .mockRejectedValue(new Error("No outbound fetch allowed"));
    app = await buildApp(stageReviewLoop());
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    fetchSpy.mockRestore();
  });

  // AC1: finishing freezes the round and review/current returns the exact slug, head
  // SHA, round number, approved:false, and every unresolved comment with usable
  // anchors. AC8: no outbound write.
  it("freezes a finished round and exposes its unresolved artifact via review/current", async () => {
    const range = await postComment(rangeAnchor);
    await postComment({ scope: "review", body: "UnresolvedReview-39" });

    const finished = await request(app!.getHttpServer())
      .patch(`${route}/review/current`)
      .send({ status: "finished" })
      .expect(200);
    const artifact = reviewArtifactSchema.parse(
      (finished.body as { data: unknown }).data,
    );

    expect(artifact.pr).toBe(pr);
    expect(artifact.headSha).toBe(fixture.headSha);
    expect(artifact.reviewRound).toBe(1);
    expect(artifact.approved).toBe(false);
    expect(artifact.comments).toHaveLength(2);

    const rangeArtifact = artifact.comments.find(
      (comment) => comment.id === range.id,
    );
    expect(rangeArtifact).toMatchObject({
      scope: "range",
      path: fixture.mirrorPath,
      startLine: 3,
      endLine: 4,
      quote: RANGE_QUOTE,
      body: "UnresolvedRange-39",
    });
    // The artifact carries no resolution field (AC5 at the wire).
    expect(rangeArtifact && "resolved" in rangeArtifact).toBe(false);

    const current = await request(app!.getHttpServer())
      .get(`${route}/review/current`)
      .expect(200);
    expect(
      reviewArtifactSchema.parse((current.body as { data: unknown }).data),
    ).toEqual(artifact);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // AC2: the artifact is unavailable (409) before finish, whether or not an open
  // round already exists.
  it("keeps the artifact unavailable while the round is open", async () => {
    await request(app!.getHttpServer())
      .get(`${route}/review/current`)
      .expect(409);

    await postComment({ scope: "review", body: "PrematureRead-39" });
    await request(app!.getHttpServer())
      .get(`${route}/review/current`)
      .expect(409);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // AC2: a finished round rejects new comments, resolution, re-finish, and approve.
  it("rejects mutation of a finished round with 409", async () => {
    const comment = await postComment({ scope: "review", body: "Frozen-39" });
    await request(app!.getHttpServer())
      .patch(`${route}/review/current`)
      .send({ status: "finished" })
      .expect(200);

    await request(app!.getHttpServer())
      .post(`${route}/comments`)
      .send({ scope: "review", body: "RejectedAfterFinish-39" })
      .expect(409);
    await request(app!.getHttpServer())
      .patch(`${route}/comments/${comment.id}`)
      .send({ resolved: true })
      .expect(409);
    await request(app!.getHttpServer())
      .patch(`${route}/review/current`)
      .send({ status: "finished" })
      .expect(409);
    await request(app!.getHttpServer())
      .patch(`${route}/review/current`)
      .send({ status: "approved" })
      .expect(409);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // A malformed PATCH body (an invalid status, or a non-strict resolution) is a 400,
  // never a state transition.
  it("rejects a malformed PATCH body with 400", async () => {
    const comment = await postComment({
      scope: "review",
      body: "Malformed-39",
    });

    await request(app!.getHttpServer())
      .patch(`${route}/review/current`)
      .send({ status: "open" })
      .expect(400);
    await request(app!.getHttpServer())
      .patch(`${route}/comments/${comment.id}`)
      .send({ resolved: false })
      .expect(400);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // AC3: no action other than an explicit resolve ever resolves a comment.
  it("never resolves a comment except by an explicit resolve action", async () => {
    const comment = await postComment(rangeAnchor);

    const stillUnresolved = async (): Promise<boolean> => {
      const surface = await request(app!.getHttpServer())
        .get(route)
        .expect(200);
      const parsed = reviewSurfaceResponseSchema.parse(
        (surface.body as { data: unknown }).data,
      );
      const found = parsed.currentRound.comments.find(
        (entry) => entry.id === comment.id,
      );
      return found?.resolved === false;
    };

    // Rendering (a GET) does not resolve.
    expect(await stillUnresolved()).toBe(true);
    // Adding another comment does not resolve the first.
    await postComment({ scope: "review", body: "Another-39" });
    expect(await stillUnresolved()).toBe(true);
    // Finishing does not resolve; the comment stays in the unresolved artifact.
    await request(app!.getHttpServer())
      .patch(`${route}/review/current`)
      .send({ status: "finished" })
      .expect(200);
    const current = await request(app!.getHttpServer())
      .get(`${route}/review/current`)
      .expect(200);
    const artifact = reviewArtifactSchema.parse(
      (current.body as { data: unknown }).data,
    );
    expect(artifact.comments.some((entry) => entry.id === comment.id)).toBe(
      true,
    );

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // AC4: approve fails with any unresolved comment; explicit resolve-all then approve
  // yields the terminal artifact (approved:true, empty comments), which is terminal.
  it("blocks approval until resolve-all, then approves into a terminal artifact", async () => {
    const comment = await postComment(rangeAnchor);

    await request(app!.getHttpServer())
      .patch(`${route}/review/current`)
      .send({ status: "approved" })
      .expect(409);

    const resolved = await request(app!.getHttpServer())
      .patch(`${route}/comments/${comment.id}`)
      .send({ resolved: true })
      .expect(200);
    const resolvedComment = reviewCommentSchema.parse(
      (resolved.body as { data: unknown }).data,
    );
    expect(resolvedComment.id).toBe(comment.id);
    expect(resolvedComment.resolved).toBe(true);

    const approved = await request(app!.getHttpServer())
      .patch(`${route}/review/current`)
      .send({ status: "approved" })
      .expect(200);
    const artifact = reviewArtifactSchema.parse(
      (approved.body as { data: unknown }).data,
    );
    expect(artifact.approved).toBe(true);
    expect(artifact.comments).toEqual([]);

    // Terminal: every mutation and re-finish is a conflict.
    await request(app!.getHttpServer())
      .patch(`${route}/review/current`)
      .send({ status: "finished" })
      .expect(409);
    await request(app!.getHttpServer())
      .patch(`${route}/review/current`)
      .send({ status: "approved" })
      .expect(409);
    await request(app!.getHttpServer())
      .patch(`${route}/comments/${comment.id}`)
      .send({ resolved: true })
      .expect(409);
    await request(app!.getHttpServer())
      .post(`${route}/comments`)
      .send({ scope: "review", body: "AfterApprove-39" })
      .expect(409);

    // The terminal artifact stays readable.
    const current = await request(app!.getHttpServer())
      .get(`${route}/review/current`)
      .expect(200);
    expect(
      reviewArtifactSchema.parse((current.body as { data: unknown }).data)
        .approved,
    ).toBe(true);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // Resolving an unknown comment id on an open round is a 404 (no such comment).
  it("returns 404 resolving a comment id absent from the open round", async () => {
    await postComment({ scope: "review", body: "Exists-39" });
    await request(app!.getHttpServer())
      .patch(`${route}/comments/does-not-exist`)
      .send({ resolved: true })
      .expect(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("exact-head round transitions", () => {
  let app: INestApplication | undefined;

  const fixture = REVIEW_LOOP;
  const slug = `${fixture.owner}/${fixture.repo}`;
  const route = `/pr/${slug}/${fixture.number}`;
  const secondHeadSha = "abcdef1234567890abcdef1234567890abcdef12";

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("requires an explicit reconciliation before a surface read creates a round", async () => {
    app = await buildApp(stageReviewLoop());

    await request(app.getHttpServer()).get(route).expect(409);
    const reconciled = await request(app.getHttpServer())
      .post(`${route}/review/reconcile`)
      .expect(200);
    expect(
      reviewRoundSchema.safeParse((reconciled.body as { data: unknown }).data)
        .success,
    ).toBe(true);
    await request(app.getHttpServer()).get(route).expect(200);
  });

  it("opens round 2 from an open round and carries only unresolved feedback with stable ids", async () => {
    const fake = stageReviewLoop();
    app = await buildApp(fake);

    const unresolvedResponse = await request(app.getHttpServer())
      .post(`${route}/comments`)
      .send({ scope: "review", body: "CarryThisOnly40" })
      .expect(201);
    const unresolved = reviewCommentSchema.parse(
      (unresolvedResponse.body as { data: unknown }).data,
    );

    const resolvedResponse = await request(app.getHttpServer())
      .post(`${route}/comments`)
      .send({ scope: "review", body: "DoNotCarryThis40" })
      .expect(201);
    const resolved = reviewCommentSchema.parse(
      (resolvedResponse.body as { data: unknown }).data,
    );
    await request(app.getHttpServer())
      .patch(`${route}/comments/${resolved.id}`)
      .send({ resolved: true })
      .expect(200);

    fake.setPullRequest(slug, reviewLoopMetadata(secondHeadSha));
    fake.setChangedFiles(slug, fixture.number, []);

    await reconcileReview(app, route);
    const response = await request(app.getHttpServer()).get(route).expect(200);
    const surface = response.body as ReviewBody;
    const currentComments = surface.data.currentRound.comments as Array<
      Record<string, unknown>
    >;

    expect(surface.data.currentRound).toMatchObject({
      number: 2,
      headSha: secondHeadSha,
    });
    expect(surface.data.rounds).toHaveLength(2);
    expect(surface.data.rounds[0]).toMatchObject({
      number: 1,
      headSha: fixture.headSha,
    });
    expect(surface.data.rounds[0].comments).toHaveLength(2);
    expect(currentComments).toEqual([
      expect.objectContaining({
        id: unresolved.id,
        headSha: secondHeadSha,
        roundNumber: 2,
        resolved: false,
        carriedForward: true,
        drifted: false,
      }),
    ]);
  });

  it("carries original anchors and applies conservative format-specific drift rules", async () => {
    const fake = stageReviewLoop();
    const removedPdfPath = "deliverables/removed-pack.pdf";
    fake.setChangedFiles(slug, fixture.number, [
      { path: fixture.mirrorPath, status: "modified" },
      { path: fixture.htmlPath, status: "modified" },
      { path: fixture.canonicalPath, status: "modified" },
      { path: fixture.pdfPath, status: "modified" },
      { path: removedPdfPath, status: "modified" },
    ]);
    app = await buildApp(fake);

    const anchors: Array<[string, FeedbackAnchor]> = [
      [
        "mirror-stable",
        {
          scope: "range",
          path: fixture.mirrorPath,
          startLine: 3,
          endLine: 3,
          quote: "The Quillibrium result is ready.",
          body: "MirrorStable40",
        },
      ],
      [
        "mirror-moved",
        {
          scope: "range",
          path: fixture.mirrorPath,
          startLine: 4,
          endLine: 4,
          quote: "Keep this exact second range line.",
          body: "MirrorMoved40",
        },
      ],
      [
        "html-stable",
        {
          scope: "line",
          path: fixture.htmlPath,
          line: 3,
          quote: "<body><p>Exact Spindlewick source line.</p></body>",
          body: "HtmlStable40",
        },
      ],
      [
        "html-moved",
        {
          scope: "line",
          path: fixture.htmlPath,
          line: 4,
          quote: "</html>",
          body: "HtmlMoved40",
        },
      ],
      [
        "canonical-stable",
        {
          scope: "file",
          path: fixture.canonicalPath,
          locator: {
            section: "Recommendation",
            quote: "Exact nearby canonical Quasartext.",
          },
          body: "CanonicalStable40",
        },
      ],
      [
        "canonical-missing-locator",
        {
          scope: "file",
          path: fixture.canonicalPath,
          locator: { section: "ObsoleteOnly40", quote: "MissingOnly40" },
          body: "CanonicalMissing40",
        },
      ],
      [
        "pdf-stable",
        {
          scope: "file",
          path: fixture.pdfPath,
          body: "PdfStable40",
        },
      ],
      [
        "pdf-removed",
        { scope: "file", path: removedPdfPath, body: "PdfRemoved40" },
      ],
      ["review", { scope: "review", body: "ReviewStable40" }],
    ];

    const ids = new Map<string, string>();
    for (const [name, anchor] of anchors) {
      const response = await request(app.getHttpServer())
        .post(`${route}/comments`)
        .send(anchor)
        .expect(201);
      const comment = reviewCommentSchema.parse(
        (response.body as { data: unknown }).data,
      );
      ids.set(name, comment.id);
    }

    fake.setPullRequest(slug, reviewLoopMetadata(secondHeadSha));
    fake.setChangedFiles(slug, fixture.number, [
      { path: fixture.mirrorPath, status: "modified" },
      { path: fixture.htmlPath, status: "modified" },
      { path: fixture.canonicalPath, status: "modified" },
      { path: fixture.pdfPath, status: "modified" },
    ]);
    fake.setBlob(slug, secondHeadSha, {
      path: fixture.mirrorPath,
      ref: secondHeadSha,
      bytes: Buffer.from(
        [
          "# Board memo",
          "",
          "The Quillibrium result is ready.",
          "Inserted before the moved quote.",
          "Keep this exact second range line.",
        ].join("\n"),
      ),
    });
    fake.setBlob(slug, secondHeadSha, {
      path: fixture.htmlPath,
      ref: secondHeadSha,
      bytes: Buffer.from(
        [
          "<!doctype html>",
          "<html>",
          "<body><p>Exact Spindlewick source line.</p></body>",
          "<footer>Inserted before the closing tag.</footer>",
          "</html>",
        ].join("\n"),
      ),
    });
    fake.setBlob(slug, secondHeadSha, {
      path: fixture.canonicalPath,
      ref: secondHeadSha,
      bytes: buildMinimalDocx(
        "Recommendation. Exact nearby canonical Quasartext.",
      ),
    });

    const finished = await request(app.getHttpServer())
      .patch(`${route}/review/current`)
      .send({ status: "finished" })
      .expect(200);
    const artifact = reviewArtifactSchema.parse(
      (finished.body as { data: unknown }).data,
    );

    expect(artifact).toMatchObject({
      headSha: secondHeadSha,
      reviewRound: 2,
      approved: false,
    });
    expect(artifact.comments).toHaveLength(anchors.length);

    const expectedDrift = new Map<string, boolean>([
      ["mirror-stable", false],
      ["mirror-moved", true],
      ["html-stable", false],
      ["html-moved", true],
      ["canonical-stable", false],
      ["canonical-missing-locator", true],
      ["pdf-stable", false],
      ["pdf-removed", true],
      ["review", false],
    ]);
    for (const [name, drifted] of expectedDrift) {
      const carried = artifact.comments.find(
        (comment) => comment.id === ids.get(name),
      );
      expect(carried).toMatchObject({
        id: ids.get(name),
        headSha: secondHeadSha,
        roundNumber: 2,
        carriedForward: true,
        drifted,
      });
      expect(carried).toMatchObject(anchors.find(([key]) => key === name)![1]);
    }
  });

  // A rendered-text anchor is reconciled on carry-forward (#63 drift detection, extended to
  // reattachment in #69): unchanged review-text at the same offsets reattaches not-drifted at
  // that same span; changed text where the exact quote is gone carries drifted, with the
  // ORIGINAL selector preserved unchanged (no invented highlight position). The moved-quote
  // reattachment path is covered by the cross-format matrix in the #69 describe above.
  it("reconciles a rendered-text anchor on carry-forward: same-position reattach, then drift when the quote is gone", async () => {
    const thirdHeadSha = "fedcba9876543210fedcba9876543210fedcba98";
    const reviewText = normalizeMirrorReviewText(fixture.mirrorHead);
    const QUOTE = "Quillibrium result";
    const START = reviewText.indexOf(QUOTE);
    const END = START + QUOTE.length;
    const renderedAnchor: FeedbackAnchor = {
      scope: "rendered",
      format: "md",
      path: fixture.mirrorPath,
      quote: QUOTE,
      prefix: reviewText.slice(Math.max(0, START - 4), START),
      suffix: reviewText.slice(END, END + 12),
      start: START,
      end: END,
      selectorVersion: 1,
      body: "RenderedDrift-63",
    };

    const fake = stageReviewLoop();
    app = await buildApp(fake);

    const created = await request(app.getHttpServer())
      .post(`${route}/comments`)
      .send(renderedAnchor)
      .expect(201);
    const createdId = reviewCommentSchema.parse(
      (created.body as { data: unknown }).data,
    ).id;

    const reconcile = async () => {
      const res = await request(app!.getHttpServer())
        .post(`${route}/review/reconcile`)
        .expect(200);
      return reviewRoundSchema.parse((res.body as { data: unknown }).data);
    };

    const selectorEvidence = {
      scope: "rendered",
      format: "md",
      path: fixture.mirrorPath,
      quote: QUOTE,
      start: START,
      end: END,
      selectorVersion: 1,
    };

    // Head 2: the Mirror head is byte-identical, so the review-text at the offsets is
    // unchanged - the carried anchor is not drifted, selector preserved.
    fake.setPullRequest(slug, reviewLoopMetadata(secondHeadSha));
    fake.setChangedFiles(slug, fixture.number, [
      { path: fixture.mirrorPath, status: "modified" },
    ]);
    fake.setBlob(slug, secondHeadSha, {
      path: fixture.mirrorPath,
      ref: secondHeadSha,
      bytes: Buffer.from(fixture.mirrorHead, "utf8"),
    });
    const round2 = await reconcile();
    const stable = round2.comments.find((entry) => entry.id === createdId);
    expect(stable).toMatchObject({
      ...selectorEvidence,
      headSha: secondHeadSha,
      carriedForward: true,
      drifted: false,
    });

    // Head 3: the Mirror head changes at the anchored span, so the review-text no
    // longer holds the quote there - drifted, but the ORIGINAL selector is preserved.
    fake.setPullRequest(slug, reviewLoopMetadata(thirdHeadSha));
    fake.setChangedFiles(slug, fixture.number, [
      { path: fixture.mirrorPath, status: "modified" },
    ]);
    fake.setBlob(slug, thirdHeadSha, {
      path: fixture.mirrorPath,
      ref: thirdHeadSha,
      bytes: Buffer.from(
        [
          "# Board memo revised heading",
          "",
          "The Zephyrium result is different.",
          "Keep this exact second range line.",
        ].join("\r\n"),
        "utf8",
      ),
    });
    const round3 = await reconcile();
    const drifted = round3.comments.find((entry) => entry.id === createdId);
    // The drifted comment still carries the original hints (start/end in
    // selectorEvidence) - drift is flagged, but no highlight position is invented.
    expect(drifted).toMatchObject({
      ...selectorEvidence,
      headSha: thirdHeadSha,
      carriedForward: true,
      drifted: true,
    });
  });

  it("deletes durable review state before returning a merged response", async () => {
    const fake = stageReviewLoop();
    app = await buildApp(fake);

    await request(app.getHttpServer())
      .post(`${route}/comments`)
      .send({ scope: "review", body: "DeleteOnMergeOnly40" })
      .expect(201);

    fake.setPullRequest(
      slug,
      Object.assign(reviewLoopMetadata(), { merged: true }),
    );
    await request(app.getHttpServer()).get(route).expect(404);

    fake.setPullRequest(
      slug,
      Object.assign(reviewLoopMetadata(), { merged: false }),
    );
    await reconcileReview(app, route);
    const reopened = await request(app.getHttpServer()).get(route).expect(200);
    const surface = reviewSurfaceResponseSchema.parse(
      (reopened.body as { data: unknown }).data,
    );
    expect(surface.currentRound).toMatchObject({
      number: 1,
      headSha: fixture.headSha,
      comments: [],
    });
    expect(surface.rounds).toHaveLength(1);
  });
});

// #3 criterion 3: pin the `reconcileAnchor` drift arms that shared source does NOT couple
// to the throwing validators. The range/line arms share `head-text.ts` helpers with the
// validators, so they cannot diverge; the rendered-decision, file/locator, and bare-file
// arms - and, critically, the ORDER of the locator-less file gate versus the
// removed-status gate - are structurally independent, so they are pinned here by driving
// the real predicate through the public reconcile surface (a mechanism the repo already
// uses for carry-forward drift). The rendered-reattach, locator-inclusion, and
// bare-file present/absent decisions are already pinned by the "exact-head round
// transitions" matrix above; this block adds the untested removed-status gate and its
// ordering, so a change to that gate's logic or position fails a test.
describe("reconcileAnchor removed-status gate and ordering (#3 drift-pin)", () => {
  let app: INestApplication | undefined;

  const fixture = REVIEW_LOOP;
  const slug = `${fixture.owner}/${fixture.repo}`;
  const route = `/pr/${slug}/${fixture.number}`;
  const secondHeadSha = fixture.secondHeadSha;

  const reviewText = normalizeMirrorReviewText(fixture.mirrorHead);
  const RENDERED_QUOTE = "Quillibrium result";
  const RENDERED_START = reviewText.indexOf(RENDERED_QUOTE);
  const RENDERED_END = RENDERED_START + RENDERED_QUOTE.length;

  const rangeAnchor: FeedbackAnchor = {
    scope: "range",
    path: fixture.mirrorPath,
    startLine: 3,
    endLine: 3,
    quote: "The Quillibrium result is ready.",
    body: "RangeRemovedPin3",
  };
  const lineAnchor: FeedbackAnchor = {
    scope: "line",
    path: fixture.htmlPath,
    line: 3,
    quote: "<body><p>Exact Spindlewick source line.</p></body>",
    body: "LineRemovedPin3",
  };
  const renderedAnchor: FeedbackAnchor = {
    scope: "rendered",
    format: "md",
    path: fixture.mirrorPath,
    quote: RENDERED_QUOTE,
    prefix: reviewText.slice(Math.max(0, RENDERED_START - 4), RENDERED_START),
    suffix: reviewText.slice(RENDERED_END, RENDERED_END + 12),
    start: RENDERED_START,
    end: RENDERED_END,
    selectorVersion: 1,
    body: "RenderedRemovedPin3",
  };
  const locatorAnchor: FeedbackAnchor = {
    scope: "file",
    path: fixture.canonicalPath,
    locator: {
      section: "Recommendation",
      quote: "Exact nearby canonical Quasartext.",
    },
    body: "LocatorRemovedPin3",
  };
  const pdfAnchor: FeedbackAnchor = {
    scope: "file",
    path: fixture.pdfPath,
    body: "PdfRemovedPin3",
  };

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  const reconcile = async () => {
    const res = await request(app!.getHttpServer())
      .post(`${route}/review/reconcile`)
      .expect(200);
    return reviewRoundSchema.parse((res.body as { data: unknown }).data);
  };

  // Plants the second head with content BYTE-IDENTICAL to the first for every path, so a
  // content check (a bypassed removed-status gate falling through to the scope arm) would
  // report not-drifted. That isolates the pins: drift=true can only come from the
  // removed-status gate, and the bare-file drift=false only from the locator-less file
  // gate winning the race against it.
  const plantIdenticalSecondHead = (fake: FakeGitHubSource): void => {
    const ref = secondHeadSha;
    fake.setBlob(slug, ref, {
      path: fixture.mirrorPath,
      ref,
      bytes: Buffer.from(fixture.mirrorHead, "utf8"),
    });
    fake.setBlob(slug, ref, {
      path: fixture.htmlPath,
      ref,
      bytes: Buffer.from(fixture.htmlHead, "utf8"),
    });
    fake.setBlob(slug, ref, {
      path: fixture.canonicalPath,
      ref,
      bytes: buildMinimalDocx(
        "Recommendation. Exact nearby canonical Quasartext.",
      ),
    });
    fake.setBlob(slug, ref, {
      path: fixture.pdfPath,
      ref,
      bytes: Buffer.from(fixture.pdfBytes),
    });
  };

  // Creates the anchor on the live first head (where its file is `modified`, so validation
  // passes and it persists), then advances to a second head where exactly `removedPath`
  // flips to `removed` while every file's bytes stay identical, and reconciles.
  const carryThenMarkRemoved = async (
    fake: FakeGitHubSource,
    anchor: FeedbackAnchor,
    removedPath: string,
  ) => {
    const created = await request(app!.getHttpServer())
      .post(`${route}/comments`)
      .send(anchor)
      .expect(201);
    const id = reviewCommentSchema.parse(
      (created.body as { data: unknown }).data,
    ).id;

    fake.setPullRequest(slug, reviewLoopMetadata(secondHeadSha));
    fake.setChangedFiles(
      slug,
      fixture.number,
      [
        fixture.mirrorPath,
        fixture.htmlPath,
        fixture.canonicalPath,
        fixture.pdfPath,
      ].map((path): ChangedFile => ({
        path,
        status: path === removedPath ? "removed" : "modified",
      })),
    );
    plantIdenticalSecondHead(fake);

    const round = await reconcile();
    return round.comments.find((entry) => entry.id === id);
  };

  it.each<[string, FeedbackAnchor, string]>([
    ["a Mirror source-range", rangeAnchor, fixture.mirrorPath],
    ["an HTML source-line", lineAnchor, fixture.htmlPath],
    ["a rendered-text", renderedAnchor, fixture.mirrorPath],
    ["a Canonical locator", locatorAnchor, fixture.canonicalPath],
  ])(
    "drifts %s anchor whose document becomes removed, even with byte-identical head content",
    async (_name, anchor, removedPath) => {
      const fake = stageReviewLoop();
      app = await buildApp(fake);

      const carried = await carryThenMarkRemoved(fake, anchor, removedPath);

      expect(carried).toMatchObject({
        headSha: secondHeadSha,
        carriedForward: true,
        drifted: true,
      });
    },
  );

  it("keeps a removed bare-file anchor not-drifted: the locator-less file gate is decided before the removed-status gate", async () => {
    const fake = stageReviewLoop();
    app = await buildApp(fake);

    const carried = await carryThenMarkRemoved(
      fake,
      pdfAnchor,
      fixture.pdfPath,
    );

    expect(carried).toMatchObject({
      headSha: secondHeadSha,
      carriedForward: true,
      drifted: false,
    });
  });
});

describe("complete multi-head review lifecycle", () => {
  let app: INestApplication | undefined;
  let fetchSpy: jest.SpyInstance;

  const fixture = REVIEW_LOOP;
  const slug = `${fixture.owner}/${fixture.repo}`;
  const route = `/pr/${slug}/${fixture.number}`;
  const anchors: FeedbackAnchor[] = [
    {
      scope: "range",
      path: fixture.mirrorPath,
      startLine: 3,
      endLine: 4,
      quote:
        "The Quillibrium result is ready.\nKeep this exact second range line.",
      body: "LifecycleMirror40",
    },
    {
      scope: "file",
      path: fixture.canonicalPath,
      locator: {
        section: "Recommendation",
        quote: "Exact nearby canonical Quasartext.",
      },
      body: "LifecycleCanonical40",
    },
    { scope: "file", path: fixture.pdfPath, body: "LifecyclePdf40" },
    {
      scope: "line",
      path: fixture.htmlPath,
      line: 3,
      quote: "<body><p>Exact Spindlewick source line.</p></body>",
      body: "LifecycleHtml40",
    },
    { scope: "review", body: "LifecycleReview40" },
  ];

  beforeEach(async () => {
    fetchSpy = jest
      .spyOn(global, "fetch")
      .mockRejectedValue(new Error("No outbound fetch allowed"));
    app = await buildApp(stageReviewLoop());
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    fetchSpy.mockRestore();
  });

  it("drives render through every anchor, carry-forward, approval, and merge cleanup", async () => {
    const fake = app!.get(GitHubSource) as FakeGitHubSource;

    await reconcileReview(app!, route);
    const initial = await request(app!.getHttpServer()).get(route).expect(200);
    const initialSurface = reviewSurfaceResponseSchema.parse(
      (initial.body as { data: unknown }).data,
    );
    expect(initialSurface.files.map((file) => file.payload.format)).toEqual([
      "docx",
      "md",
      "html",
      "pdf",
    ]);

    const createdIds: string[] = [];
    for (const anchor of anchors) {
      const response = await request(app!.getHttpServer())
        .post(`${route}/comments`)
        .send(anchor)
        .expect(201);
      createdIds.push(
        reviewCommentSchema.parse((response.body as { data: unknown }).data).id,
      );
    }

    const firstFinished = await request(app!.getHttpServer())
      .patch(`${route}/review/current`)
      .send({ status: "finished" })
      .expect(200);
    const firstArtifact = reviewArtifactSchema.parse(
      (firstFinished.body as { data: unknown }).data,
    );
    expect(firstArtifact).toMatchObject({
      headSha: fixture.headSha,
      reviewRound: 1,
      approved: false,
    });
    expect(firstArtifact.comments.map((comment) => comment.id)).toEqual(
      createdIds,
    );
    expect(
      firstArtifact.comments.every(
        (comment) => !comment.carriedForward && !comment.drifted,
      ),
    ).toBe(true);

    stageReviewLoopSecondHead(fake);
    await reconcileReview(app!, route);
    const second = await request(app!.getHttpServer()).get(route).expect(200);
    const secondSurface = reviewSurfaceResponseSchema.parse(
      (second.body as { data: unknown }).data,
    );
    expect(secondSurface.currentRound).toMatchObject({
      number: 2,
      headSha: fixture.secondHeadSha,
      status: "open",
    });
    expect(secondSurface.rounds).toHaveLength(2);
    expect(
      secondSurface.currentRound.comments.map((comment) => comment.id),
    ).toEqual(createdIds);
    expect(
      secondSurface.currentRound.comments.every(
        (comment) => comment.carriedForward,
      ),
    ).toBe(true);
    expect(
      secondSurface.currentRound.comments.find(
        (comment) => comment.scope === "range",
      )?.drifted,
    ).toBe(true);
    expect(
      secondSurface.currentRound.comments
        .filter((comment) => comment.scope !== "range")
        .every((comment) => !comment.drifted),
    ).toBe(true);

    for (const comment of secondSurface.currentRound.comments) {
      await request(app!.getHttpServer())
        .patch(`${route}/comments/${comment.id}`)
        .send({ resolved: true })
        .expect(200);
    }
    const approved = await request(app!.getHttpServer())
      .patch(`${route}/review/current`)
      .send({ status: "approved" })
      .expect(200);
    expect(
      reviewArtifactSchema.parse((approved.body as { data: unknown }).data),
    ).toMatchObject({
      headSha: fixture.secondHeadSha,
      reviewRound: 2,
      approved: true,
      comments: [],
    });

    fake.setPullRequest(
      slug,
      Object.assign(reviewLoopMetadata(fixture.secondHeadSha), {
        merged: true,
      }),
    );
    await request(app!.getHttpServer()).get(route).expect(404);

    fake.setPullRequest(slug, reviewLoopMetadata());
    await reconcileReview(app!, route);
    const reopened = await request(app!.getHttpServer()).get(route).expect(200);
    const reopenedSurface = reviewSurfaceResponseSchema.parse(
      (reopened.body as { data: unknown }).data,
    );
    expect(reopenedSurface.currentRound).toMatchObject({
      number: 1,
      comments: [],
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// The #69 gate: rendered-text comments are reconciled across exact heads through the pure
// #68 reattachment decision. Unresolved Mirror, Canonical, and HTML rendered comments are
// carried into the new round with a server-owned drift result, their span RECOMPUTED when
// the exact quote plus stored context single out one safe location and their stored selector
// preserved otherwise. Every case runs with outbound `fetch` planted to throw and uses only
// the FakeGitHubSource (criterion 7): no GitHub write and no annotation-service call occurs
// on the review plane, and the source exposes no write method for reconciliation to reach.
describe("rendered-text reconciliation across exact heads (#69)", () => {
  let app: INestApplication | undefined;
  let fetchSpy: jest.SpyInstance;

  const fixture = REVIEW_LOOP;
  const slug = `${fixture.owner}/${fixture.repo}`;
  const route = `/pr/${slug}/${fixture.number}`;
  const pr = `${slug}#${fixture.number}`;
  const secondHeadSha = "abcdef1234567890abcdef1234567890abcdef12";
  const thirdHeadSha = "fedcba9876543210fedcba9876543210fedcba98";

  // A rendered-text anchor whose 12-char immediate prefix/suffix are read from the
  // review-text, exactly as the server validates them at post time - so the stored context
  // the reattachment decision later reads is real, not a hand-picked window.
  const renderedAnchorFor = (
    format: "md" | "html" | "docx",
    path: string,
    reviewText: string,
    quote: string,
    body: string,
  ): Extract<FeedbackAnchor, { scope: "rendered" }> => {
    const start = reviewText.indexOf(quote);
    if (start === -1) {
      throw new Error(`fixture quote not found in review-text: ${quote}`);
    }
    const end = start + quote.length;
    return {
      scope: "rendered",
      format,
      path,
      quote,
      prefix: reviewText.slice(Math.max(0, start - 12), start),
      suffix: reviewText.slice(end, end + 12),
      start,
      end,
      selectorVersion: 1,
      body,
    };
  };

  const setTextBlob = (
    fake: FakeGitHubSource,
    path: string,
    ref: string,
    text: string,
  ): void => {
    fake.setBlob(slug, ref, { path, ref, bytes: Buffer.from(text, "utf8") });
  };

  const submit = async (anchor: FeedbackAnchor): Promise<string> => {
    const response = await request(app!.getHttpServer())
      .post(`${route}/comments`)
      .send(anchor)
      .expect(201);
    return reviewCommentSchema.parse((response.body as { data: unknown }).data)
      .id;
  };

  const advanceHead = (fake: FakeGitHubSource, headSha: string): void => {
    fake.setPullRequest(slug, reviewLoopMetadata(headSha));
  };

  const reconcile = async () => {
    const res = await request(app!.getHttpServer())
      .post(`${route}/review/reconcile`)
      .expect(200);
    return reviewRoundSchema.parse((res.body as { data: unknown }).data);
  };

  beforeEach(() => {
    fetchSpy = jest
      .spyOn(global, "fetch")
      .mockRejectedValue(new Error("No outbound fetch allowed"));
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    fetchSpy.mockRestore();
  });

  // Criterion 1: the round transition carries only unresolved rendered comments, records the
  // new head and the stable identity, and stamps carried-forward plus the server-owned drift
  // result and the carried selector evidence.
  it("carries only the unresolved rendered comment into the new exact-head round with identity, carried-forward, selector evidence, and drift result", async () => {
    const reviewText = normalizeMirrorReviewText(fixture.mirrorHead);
    const carriedAnchor = renderedAnchorFor(
      "md",
      fixture.mirrorPath,
      reviewText,
      "The Quillibrium result is ready.",
      "CarryRendered69",
    );
    const droppedAnchor = renderedAnchorFor(
      "md",
      fixture.mirrorPath,
      reviewText,
      "Keep this exact second range line.",
      "ResolvedRendered69",
    );

    const fake = stageReviewLoop();
    app = await buildApp(fake);
    const carriedId = await submit(carriedAnchor);
    const droppedId = await submit(droppedAnchor);
    await request(app.getHttpServer())
      .patch(`${route}/comments/${droppedId}`)
      .send({ resolved: true })
      .expect(200);

    // The second head keeps the Mirror byte-identical, so the carried anchor's quote still
    // sits at its span: it reattaches not-drifted at the same offsets.
    advanceHead(fake, secondHeadSha);
    setTextBlob(fake, fixture.mirrorPath, secondHeadSha, fixture.mirrorHead);
    const round = await reconcile();

    expect(round.headSha).toBe(secondHeadSha);
    expect(round.number).toBe(2);
    // Only the unresolved comment carried; the resolved one did not.
    expect(round.comments.map((entry) => entry.id)).toEqual([carriedId]);
    expect(
      round.comments.find((entry) => entry.id === droppedId),
    ).toBeUndefined();
    expect(round.comments[0]).toMatchObject({
      id: carriedId,
      headSha: secondHeadSha,
      roundNumber: 2,
      carriedForward: true,
      drifted: false,
      scope: "rendered",
      format: "md",
      path: fixture.mirrorPath,
      quote: carriedAnchor.quote,
      prefix: carriedAnchor.prefix,
      suffix: carriedAnchor.suffix,
      start: carriedAnchor.start,
      end: carriedAnchor.end,
      selectorVersion: 1,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // Criterion 2: unchanged same-position and uniquely moved quotes reattach for Mirror,
  // Canonical, and HTML with distinct per-format sentinels, and the original position is
  // accepted only when it still yields the exact quote (the moved case genuinely relocates,
  // proving the stored offsets are hints the decision recomputes).
  it("reattaches unchanged and uniquely moved quotes across Mirror, Canonical, and HTML", async () => {
    const mirrorHead1 = [
      "# Ledger",
      "",
      "Alpha stable mirror clause anchored in place.",
      "",
      "Filler mirror ay separates the stable region cleanly.",
      "",
      "Filler mirror bee cushions the mover from the insert.",
      "",
      "Charlie mover mirror clause relocates by one block.",
    ].join("\n");
    const mirrorHead2 = [
      "# Ledger",
      "",
      "Alpha stable mirror clause anchored in place.",
      "",
      "Filler mirror ay separates the stable region cleanly.",
      "",
      "Inserted mirror paragraph pushes the mover downward.",
      "",
      "Filler mirror bee cushions the mover from the insert.",
      "",
      "Charlie mover mirror clause relocates by one block.",
    ].join("\n");

    const htmlHead1 = [
      "<!doctype html>",
      "<html>",
      "<body>",
      "<h1>Spindlewick ledger</h1>",
      "<p>Alpha stable html clause anchored in place.</p>",
      "<p>Filler html ay separates the stable region cleanly.</p>",
      "<p>Filler html bee cushions the mover from the insert.</p>",
      "<p>Charlie mover html clause relocates by one block.</p>",
      "</body>",
      "</html>",
    ].join("\n");
    const htmlHead2 = [
      "<!doctype html>",
      "<html>",
      "<body>",
      "<h1>Spindlewick ledger</h1>",
      "<p>Alpha stable html clause anchored in place.</p>",
      "<p>Filler html ay separates the stable region cleanly.</p>",
      "<p>Inserted html paragraph pushes the mover downward.</p>",
      "<p>Filler html bee cushions the mover from the insert.</p>",
      "<p>Charlie mover html clause relocates by one block.</p>",
      "</body>",
      "</html>",
    ].join("\n");

    const canonicalHead1Body =
      "Intro docx preamble words lead in. Alpha stable docx clause anchored in place. Middle docx filler words follow along here. Charlie mover docx clause relocates onward.";
    const canonicalHead2Body =
      "Intro docx preamble words lead in. Alpha stable docx clause anchored in place. Middle docx filler words plus a widened inserted padding span follow along here. Charlie mover docx clause relocates onward.";
    const canonicalHead1 = buildMinimalDocx(canonicalHead1Body);
    const canonicalHead2 = buildMinimalDocx(canonicalHead2Body);

    const mirrorReview1 = normalizeMirrorReviewText(mirrorHead1);
    const mirrorReview2 = normalizeMirrorReviewText(mirrorHead2);
    const htmlReview1 = normalizeHtmlReviewText(htmlHead1);
    const htmlReview2 = normalizeHtmlReviewText(htmlHead2);
    const canonicalReview1 = (await convertCanonicalHtml(canonicalHead1))
      .reviewText;
    const canonicalReview2 = (await convertCanonicalHtml(canonicalHead2))
      .reviewText;

    const cases = [
      {
        format: "md" as const,
        path: fixture.mirrorPath,
        head1: mirrorHead1,
        head2: mirrorHead2,
        review1: mirrorReview1,
        review2: mirrorReview2,
        stableQuote: "Alpha stable mirror clause anchored in place.",
        moverQuote: "Charlie mover mirror clause relocates by one block.",
      },
      {
        format: "html" as const,
        path: fixture.htmlPath,
        head1: htmlHead1,
        head2: htmlHead2,
        review1: htmlReview1,
        review2: htmlReview2,
        stableQuote: "Alpha stable html clause anchored in place.",
        moverQuote: "Charlie mover html clause relocates by one block.",
      },
      {
        format: "docx" as const,
        path: fixture.canonicalPath,
        head1: canonicalHead1,
        head2: canonicalHead2,
        review1: canonicalReview1,
        review2: canonicalReview2,
        stableQuote: "Alpha stable docx clause anchored in place.",
        moverQuote: "Charlie mover docx clause relocates onward.",
      },
    ];

    const fake = stageReviewLoop();
    for (const testCase of cases) {
      fake.setBlob(slug, fixture.headSha, {
        path: testCase.path,
        ref: fixture.headSha,
        bytes:
          typeof testCase.head1 === "string"
            ? Buffer.from(testCase.head1, "utf8")
            : testCase.head1,
      });
    }
    app = await buildApp(fake);

    const stableIds = new Map<string, string>();
    const moverIds = new Map<string, string>();
    for (const testCase of cases) {
      stableIds.set(
        testCase.format,
        await submit(
          renderedAnchorFor(
            testCase.format,
            testCase.path,
            testCase.review1,
            testCase.stableQuote,
            `Stable-${testCase.format}-69`,
          ),
        ),
      );
      moverIds.set(
        testCase.format,
        await submit(
          renderedAnchorFor(
            testCase.format,
            testCase.path,
            testCase.review1,
            testCase.moverQuote,
            `Mover-${testCase.format}-69`,
          ),
        ),
      );
    }

    advanceHead(fake, secondHeadSha);
    for (const testCase of cases) {
      fake.setBlob(slug, secondHeadSha, {
        path: testCase.path,
        ref: secondHeadSha,
        bytes:
          typeof testCase.head2 === "string"
            ? Buffer.from(testCase.head2, "utf8")
            : testCase.head2,
      });
    }
    const round = await reconcile();

    for (const testCase of cases) {
      const stable = round.comments.find(
        (entry) => entry.id === stableIds.get(testCase.format),
      );
      const mover = round.comments.find(
        (entry) => entry.id === moverIds.get(testCase.format),
      );

      // The stable quote never moves: it reattaches not-drifted at its original span, which
      // still yields the exact quote in the new review-text.
      const stableStart = testCase.review2.indexOf(testCase.stableQuote);
      expect(stableStart).toBe(testCase.review1.indexOf(testCase.stableQuote));
      expect(stable).toMatchObject({
        carriedForward: true,
        drifted: false,
        quote: testCase.stableQuote,
        start: stableStart,
        end: stableStart + testCase.stableQuote.length,
      });

      // The mover genuinely relocates (new offset differs), and still reattaches not-drifted
      // because its exact quote and stored context single out one location.
      const moverOld = testCase.review1.indexOf(testCase.moverQuote);
      const moverNew = testCase.review2.indexOf(testCase.moverQuote);
      expect(moverNew).not.toBe(moverOld);
      expect(mover).toMatchObject({
        carriedForward: true,
        drifted: false,
        quote: testCase.moverQuote,
        start: moverNew,
        end: moverNew + testCase.moverQuote.length,
      });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // Criterion 3: context-disambiguated duplicates reattach, while ambiguous duplicates,
  // changed quotes, removed files, and deleted (missing) quotes remain unresolved and drifted
  // with the ORIGINAL selector preserved. (Malformed and out-of-range hints are unreachable
  // through create+reconcile - a stored selector was valid at its own head - and are proven
  // in the focused #68 decision table; the out-of-range guard is exercised here by a
  // review-text that no longer contains the quote.)
  it("reattaches a context-disambiguated duplicate but drifts ambiguous, changed, removed, and deleted quotes with the original selector preserved", async () => {
    const disambiguatable = "Alpha zone SIGMATOKEN closes the alpha region.";
    // The ambiguous quote's immediate context sits WITHIN its own line, so when the next
    // head repeats the whole line both occurrences carry identical stored context and neither
    // can be singled out (a genuine ambiguous duplicate, not a cross-block distinction).
    const ambiguous = "ditto ditto ditto ECHOTOKEN ditto ditto ditto.";
    const changed = "Original PHRASETOKEN anchors the changing note.";
    const removed = "Removed file RETIRETOKEN sits in a doomed document.";
    const deleted = "Deleted quote DROPTOKEN vanishes from the next head.";

    const head1 = [
      `# Duplicate ledger`,
      "",
      disambiguatable,
      "",
      ambiguous,
      "",
      changed,
      "",
      deleted,
    ].join("\n");
    const removedPath = "deliverables/retired-note.md";
    const removedHead1 = ["# Retired ledger", "", removed].join("\n");

    const review1 = normalizeMirrorReviewText(head1);
    const removedReview1 = normalizeMirrorReviewText(removedHead1);
    // A second head where the disambiguatable quote now appears twice (context picks the
    // first), the ambiguous quote appears twice with identical context (drift), the changed
    // quote is edited (drift), and the deleted quote is gone (drift).
    const head2 = [
      `# Duplicate ledger`,
      "",
      disambiguatable,
      "",
      "Beta zone SIGMATOKEN closes the beta region.",
      "",
      ambiguous,
      "",
      ambiguous,
      "",
      "Revised PHRASETOKEN anchors the changed note.",
    ].join("\n");
    const review2 = normalizeMirrorReviewText(head2);
    // The disambiguatable quote is now a genuine duplicate that only context separates.
    expect(review2.split(disambiguatable).length - 1).toBe(1);
    expect(review2.split("SIGMATOKEN").length - 1).toBe(2);
    expect(review2.split(ambiguous).length - 1).toBe(2);
    expect(review2.includes(changed)).toBe(false);
    expect(review2.includes(deleted)).toBe(false);

    const fake = stageReviewLoop();
    fake.setChangedFiles(slug, fixture.number, [
      { path: fixture.mirrorPath, status: "modified" },
      { path: removedPath, status: "modified" },
    ]);
    setTextBlob(fake, fixture.mirrorPath, fixture.headSha, head1);
    setTextBlob(fake, removedPath, fixture.headSha, removedHead1);
    app = await buildApp(fake);

    const disambiguatableAnchor = renderedAnchorFor(
      "md",
      fixture.mirrorPath,
      review1,
      "SIGMATOKEN",
      "Duplicate69",
    );
    const ambiguousAnchor = renderedAnchorFor(
      "md",
      fixture.mirrorPath,
      review1,
      "ECHOTOKEN",
      "Ambiguous69",
    );
    const changedAnchor = renderedAnchorFor(
      "md",
      fixture.mirrorPath,
      review1,
      "PHRASETOKEN",
      "Changed69",
    );
    const removedAnchor = renderedAnchorFor(
      "md",
      removedPath,
      removedReview1,
      "RETIRETOKEN",
      "Removed69",
    );
    const deletedAnchor = renderedAnchorFor(
      "md",
      fixture.mirrorPath,
      review1,
      "DROPTOKEN",
      "Deleted69",
    );

    const disambiguatableId = await submit(disambiguatableAnchor);
    const ambiguousId = await submit(ambiguousAnchor);
    const changedId = await submit(changedAnchor);
    const removedId = await submit(removedAnchor);
    const deletedId = await submit(deletedAnchor);

    advanceHead(fake, secondHeadSha);
    fake.setChangedFiles(slug, fixture.number, [
      { path: fixture.mirrorPath, status: "modified" },
      { path: removedPath, status: "removed" },
    ]);
    setTextBlob(fake, fixture.mirrorPath, secondHeadSha, head2);
    const round = await reconcile();

    // The context-disambiguated duplicate reattaches at the first occurrence.
    const winnerStart = review2.indexOf("SIGMATOKEN");
    expect(
      round.comments.find((entry) => entry.id === disambiguatableId),
    ).toMatchObject({
      drifted: false,
      quote: "SIGMATOKEN",
      start: winnerStart,
      end: winnerStart + "SIGMATOKEN".length,
    });

    // Every unsafe outcome drifts with the ORIGINAL selector preserved unchanged.
    for (const [id, original] of [
      [ambiguousId, ambiguousAnchor],
      [changedId, changedAnchor],
      [removedId, removedAnchor],
      [deletedId, deletedAnchor],
    ] as const) {
      expect(round.comments.find((entry) => entry.id === id)).toMatchObject({
        carriedForward: true,
        drifted: true,
        quote: original.quote,
        prefix: original.prefix,
        suffix: original.suffix,
        start: original.start,
        end: original.end,
      });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // Criterion 2/3 boundary counter: an empty prefix is a document-START boundary claim, not a
  // wildcard. A quote that began the document reattaches only while it still begins it; once
  // the next head prepends content the quote moves off the boundary and DRIFTS with its
  // original selector preserved, rather than reattaching to a mid-document location the client
  // paint gate (which holds the same boundary claim) would refuse to highlight.
  it("drifts a document-start quote once the next head prepends content, keeping the original selector", async () => {
    const startQuote = "Startquote sentence begins the mirror document.";
    const head1 = [
      startQuote,
      "",
      "Filler mirror body paragraph follows the opening.",
    ].join("\n");
    const review1 = normalizeMirrorReviewText(head1);
    const boundaryAnchor = renderedAnchorFor(
      "md",
      fixture.mirrorPath,
      review1,
      startQuote,
      "BoundaryStart69",
    );
    // The anchor genuinely holds the document-start boundary claim (empty prefix at index 0).
    expect(boundaryAnchor.prefix).toBe("");
    expect(boundaryAnchor.start).toBe(0);

    const fake = stageReviewLoop();
    fake.setChangedFiles(slug, fixture.number, [
      { path: fixture.mirrorPath, status: "modified" },
    ]);
    setTextBlob(fake, fixture.mirrorPath, fixture.headSha, head1);
    app = await buildApp(fake);
    const id = await submit(boundaryAnchor);

    const head2 = [
      "Prepended opening paragraph now leads the document.",
      "",
      startQuote,
      "",
      "Filler mirror body paragraph follows the opening.",
    ].join("\n");
    advanceHead(fake, secondHeadSha);
    setTextBlob(fake, fixture.mirrorPath, secondHeadSha, head2);
    const review2 = normalizeMirrorReviewText(head2);
    // The quote is still unique, but it no longer begins the document.
    expect(review2.split(startQuote).length - 1).toBe(1);
    expect(review2.indexOf(startQuote)).toBeGreaterThan(0);

    const round = await reconcile();
    expect(round.comments.find((entry) => entry.id === id)).toMatchObject({
      carriedForward: true,
      drifted: true,
      quote: startQuote,
      prefix: boundaryAnchor.prefix,
      suffix: boundaryAnchor.suffix,
      start: boundaryAnchor.start,
      end: boundaryAnchor.end,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // Criterion 4: a valid but wrong position never overrides a quote mismatch. The stored span
  // stays in range on the new head but now holds DIFFERENT text and the quote appears nowhere,
  // so the comment drifts with its original selector in BOTH durable review state and the
  // frozen artifact - the in-range offsets never revive the stale anchor.
  it("never lets a valid-but-wrong position override a quote mismatch in durable state or the frozen artifact", async () => {
    const quote = "The FLAGTOKEN marker sits at the original span.";
    const head1 = ["# Position ledger", "", quote].join("\n");
    // A same-length replacement so the old span stays in range but holds different text, and
    // the quote appears nowhere in the new head.
    const head2 = [
      "# Position ledger",
      "",
      "The OTHERTOKEN marker sits at the original span.",
    ].join("\n");
    const review1 = normalizeMirrorReviewText(head1);
    const originalAnchor = renderedAnchorFor(
      "md",
      fixture.mirrorPath,
      review1,
      quote,
      "WrongPosition69",
    );

    const fake = stageReviewLoop();
    fake.setChangedFiles(slug, fixture.number, [
      { path: fixture.mirrorPath, status: "modified" },
    ]);
    setTextBlob(fake, fixture.mirrorPath, fixture.headSha, head1);
    app = await buildApp(fake);
    const id = await submit(originalAnchor);

    advanceHead(fake, secondHeadSha);
    setTextBlob(fake, fixture.mirrorPath, secondHeadSha, head2);
    const review2 = normalizeMirrorReviewText(head2);
    // The old span is still addressable but no longer holds the quote, and the quote is gone.
    expect(originalAnchor.end).toBeLessThanOrEqual(review2.length);
    expect(review2.slice(originalAnchor.start, originalAnchor.end)).not.toBe(
      quote,
    );
    expect(review2.includes(quote)).toBe(false);

    const round = await reconcile();
    const durable = round.comments.find((entry) => entry.id === id);
    expect(durable).toMatchObject({
      drifted: true,
      quote,
      prefix: originalAnchor.prefix,
      suffix: originalAnchor.suffix,
      start: originalAnchor.start,
      end: originalAnchor.end,
    });

    const finished = await request(app.getHttpServer())
      .patch(`${route}/review/current`)
      .send({ status: "finished" })
      .expect(200);
    const artifact = reviewArtifactSchema.parse(
      (finished.body as { data: unknown }).data,
    );
    expect(artifact.comments.find((entry) => entry.id === id)).toMatchObject({
      drifted: true,
      quote,
      prefix: originalAnchor.prefix,
      suffix: originalAnchor.suffix,
      start: originalAnchor.start,
      end: originalAnchor.end,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // Criterion 5: a complete multi-head lifecycle - the reconciled round exposes the carried
  // selector and drift state in the read-only artifact, and resolve, approval, exact-head
  // sequencing, restart persistence, and merge cleanup keep their existing semantics.
  it("exposes carried selector and drift in the artifact while resolve, approval, restart, and merge cleanup keep their semantics", async () => {
    const moverQuote = "The Quillibrium mover clause rides to its new offset.";
    const driftQuote = "Doomed lifecycle clause vanishes on the next head.";
    // The mover is the last block (its neighbours move with it); the drift quote is an
    // earlier block whose text the next head rewrites.
    const head1 = [
      "# Board memo",
      "",
      driftQuote,
      "",
      "Filler lifecycle paragraph cushions the mover cleanly.",
      "",
      moverQuote,
    ].join("\n");
    const review1 = normalizeMirrorReviewText(head1);
    const moverAnchor = renderedAnchorFor(
      "md",
      fixture.mirrorPath,
      review1,
      moverQuote,
      "LifecycleMover69",
    );
    const driftAnchor = renderedAnchorFor(
      "md",
      fixture.mirrorPath,
      review1,
      driftQuote,
      "LifecycleDrift69",
    );

    const statePath = join(
      tmpdir(),
      `doc-review-rendered-69-${process.pid}-${randomUUID()}.json`,
    );
    testStatePaths.add(statePath);
    const fake = stageReviewLoop();
    fake.setChangedFiles(slug, fixture.number, [
      { path: fixture.mirrorPath, status: "modified" },
    ]);
    setTextBlob(fake, fixture.mirrorPath, fixture.headSha, head1);
    app = await buildApp(fake, statePath);
    const moverId = await submit(moverAnchor);
    const driftId = await submit(driftAnchor);

    // Round 1 freezes with both rendered comments uncarried and undrifted.
    const firstFinished = await request(app.getHttpServer())
      .patch(`${route}/review/current`)
      .send({ status: "finished" })
      .expect(200);
    const firstArtifact = reviewArtifactSchema.parse(
      (firstFinished.body as { data: unknown }).data,
    );
    expect(firstArtifact).toMatchObject({
      headSha: fixture.headSha,
      reviewRound: 1,
    });
    expect(
      firstArtifact.comments.every(
        (comment) => !comment.carriedForward && !comment.drifted,
      ),
    ).toBe(true);

    // The second head inserts a block before the mover's own filler (so the mover keeps its
    // immediate context and relocates) and rewrites the drift quote's block (so it drifts).
    const head2 = [
      "# Board memo",
      "",
      "Revised lifecycle clause replaces the doomed sentence.",
      "",
      "An inserted lifecycle paragraph pushes the mover downward.",
      "",
      "Filler lifecycle paragraph cushions the mover cleanly.",
      "",
      moverQuote,
    ].join("\n");
    advanceHead(fake, secondHeadSha);
    setTextBlob(fake, fixture.mirrorPath, secondHeadSha, head2);
    const review2 = normalizeMirrorReviewText(head2);
    await reconcile();

    // Restart: reload the durable state from disk into a fresh application and re-stage the
    // heads, then read the reconciled round from the surface.
    await app.close();
    app = await buildApp(fake, statePath);
    const surface = await request(app.getHttpServer()).get(route).expect(200);
    const parsed = reviewSurfaceResponseSchema.parse(
      (surface.body as { data: unknown }).data,
    );
    expect(parsed.currentRound).toMatchObject({
      number: 2,
      headSha: secondHeadSha,
    });
    const moverNew = review2.indexOf(moverQuote);
    expect(moverNew).not.toBe(moverAnchor.start);
    expect(
      parsed.currentRound.comments.find((comment) => comment.id === moverId),
    ).toMatchObject({
      carriedForward: true,
      drifted: false,
      quote: moverQuote,
      start: moverNew,
      end: moverNew + moverQuote.length,
    });
    expect(
      parsed.currentRound.comments.find((comment) => comment.id === driftId),
    ).toMatchObject({
      carriedForward: true,
      drifted: true,
      quote: driftQuote,
      start: driftAnchor.start,
      end: driftAnchor.end,
    });

    // Finishing the reconciled round exposes the carried selector and drift state in the
    // read-only artifact.
    const secondFinished = await request(app.getHttpServer())
      .patch(`${route}/review/current`)
      .send({ status: "finished" })
      .expect(200);
    const secondArtifact = reviewArtifactSchema.parse(
      (secondFinished.body as { data: unknown }).data,
    );
    expect(secondArtifact).toMatchObject({
      pr,
      headSha: secondHeadSha,
      reviewRound: 2,
    });
    expect(
      secondArtifact.comments.find((entry) => entry.id === moverId),
    ).toMatchObject({
      carriedForward: true,
      drifted: false,
      quote: moverQuote,
      start: moverNew,
      end: moverNew + moverQuote.length,
    });
    expect(
      secondArtifact.comments.find((entry) => entry.id === driftId),
    ).toMatchObject({
      carriedForward: true,
      drifted: true,
      quote: driftQuote,
      start: driftAnchor.start,
      end: driftAnchor.end,
    });
    // No browser-only annotation state rode into the frozen artifact.
    expect(
      secondArtifact.comments.some(
        (entry) => "resolved" in entry || "target" in entry,
      ),
    ).toBe(false);

    // A frozen round rejects a further finish, and approval requires zero unresolved: the
    // exact-head sequencing and resolve semantics are unchanged.
    await request(app.getHttpServer())
      .patch(`${route}/review/current`)
      .send({ status: "approved" })
      .expect(409);

    // A new exact head opens round 3; resolve every carried comment, then approve.
    advanceHead(fake, thirdHeadSha);
    setTextBlob(fake, fixture.mirrorPath, thirdHeadSha, head2);
    const round3 = await reconcile();
    for (const comment of round3.comments) {
      await request(app.getHttpServer())
        .patch(`${route}/comments/${comment.id}`)
        .send({ resolved: true })
        .expect(200);
    }
    const approved = await request(app.getHttpServer())
      .patch(`${route}/review/current`)
      .send({ status: "approved" })
      .expect(200);
    expect(
      reviewArtifactSchema.parse((approved.body as { data: unknown }).data),
    ).toMatchObject({
      headSha: thirdHeadSha,
      reviewRound: 3,
      approved: true,
      comments: [],
    });

    // Merge cleanup deletes the durable review state before the merged 404.
    fake.setPullRequest(
      slug,
      Object.assign(reviewLoopMetadata(thirdHeadSha), { merged: true }),
    );
    await request(app.getHttpServer()).get(route).expect(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// The #8 gate: a modified md file whose head changes exactly one word from base.
// `Xanthovex` (base only) and `Quorvex` (head only) are counter-fixtures - they
// appear nowhere else - so the diff must mark `Xanthovex` removed and `Quorvex`
// added, and the rendered head must be HTML of the head content.
describe("GET /pr/:owner/:repo/:number (md renderer seam)", () => {
  let app: INestApplication | undefined;

  const MD_NUMBER = 7;
  const MD_PATH = "deliverables/report.md";
  const BASE_MD = "# Q3 Report\n\nThe Xanthovex metric holds firm.\n";
  const HEAD_MD = "# Q3 Report\n\nThe **Quorvex** metric holds firm.\n";

  const mdMeta: PullRequestMetadata = {
    ...meta,
    number: MD_NUMBER,
    branch: "agent/report",
    baseBranch: "main",
  };

  const mdFake = (): FakeGitHubSource => {
    const fake = new FakeGitHubSource();
    fake.setPullRequest(SLUG, mdMeta);
    fake.setChangedFiles(SLUG, MD_NUMBER, [
      { path: MD_PATH, status: "modified" },
    ]);
    fake.setBlob(SLUG, mdMeta.headSha, blob(MD_PATH, mdMeta.headSha, HEAD_MD));
    fake.setBlob(
      SLUG,
      mdMeta.baseBranch,
      blob(MD_PATH, mdMeta.baseBranch, BASE_MD),
    );
    return fake;
  };

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("marks the changed words in the word diff and renders the head to HTML", async () => {
    app = await buildApp(mdFake());
    await reconcileReview(app, `/pr/${SLUG}/${MD_NUMBER}`);

    const response = await request(app.getHttpServer())
      .get(`/pr/${SLUG}/${MD_NUMBER}`)
      .expect(200);
    const payload = (response.body as ReviewBody).data.files.find(
      (file) => file.path === MD_PATH,
    )?.payload;

    expect(payload?.format).toBe("md");

    const diff = payload?.diff ?? [];
    const removed = diff
      .filter((segment) => segment.removed)
      .map((segment) => segment.value)
      .join("");
    const added = diff
      .filter((segment) => segment.added)
      .map((segment) => segment.value)
      .join("");
    expect(removed).toContain("Xanthovex");
    expect(added).toContain("Quorvex");

    // The rendered head is HTML of the head content: its text and its markup.
    const renderedHead = payload?.renderedHead ?? "";
    expect(renderedHead).toContain("Quorvex");
    expect(renderedHead).toContain("<h1>");
    expect(renderedHead).toContain("<strong>Quorvex</strong>");
  });
});

// The #63 gate (AC2): the Mirror renderer produces one deterministic normalized
// review-text from the exact head. The counter-fixture head carries a unique heading,
// inline markup, blank-line boundaries, and paragraph sentinels, while the base holds
// entirely different text. The produced review-text must flatten the markup, order the
// blocks as the head reads, and derive from the head - never the base or the diff.
describe("GET /pr/:owner/:repo/:number (Mirror normalized review-text seam)", () => {
  let app: INestApplication | undefined;

  const RT_NUMBER = 63;
  const RT_PATH = "deliverables/mirror.md";
  const BASE_MD = ["# Old Heading", "", "Baseonly Manxome content."].join("\n");
  const HEAD_MD = [
    "# Zylographic Overview",
    "",
    "The **Bandersnatch** metric and _Frumious_ note hold firm.",
    "",
    "Second paragraph names the Vorpalsentinel token.",
  ].join("\n");
  const EXPECTED_REVIEW_TEXT = [
    "Zylographic Overview",
    "The Bandersnatch metric and Frumious note hold firm.",
    "Second paragraph names the Vorpalsentinel token.",
  ].join("\n\n");

  const rtMeta: PullRequestMetadata = {
    ...meta,
    number: RT_NUMBER,
    branch: "agent/mirror",
    baseBranch: "main",
  };

  const rtFake = (): FakeGitHubSource => {
    const fake = new FakeGitHubSource();
    fake.setPullRequest(SLUG, rtMeta);
    fake.setChangedFiles(SLUG, RT_NUMBER, [
      { path: RT_PATH, status: "modified" },
    ]);
    fake.setBlob(SLUG, rtMeta.headSha, blob(RT_PATH, rtMeta.headSha, HEAD_MD));
    fake.setBlob(
      SLUG,
      rtMeta.baseBranch,
      blob(RT_PATH, rtMeta.baseBranch, BASE_MD),
    );
    return fake;
  };

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("produces a deterministic, head-derived, order-preserving review-text", async () => {
    app = await buildApp(rtFake());
    await reconcileReview(app, `/pr/${SLUG}/${RT_NUMBER}`);

    const response = await request(app.getHttpServer())
      .get(`/pr/${SLUG}/${RT_NUMBER}`)
      .expect(200);
    const payload = (response.body as ReviewBody).data.files.find(
      (file) => file.path === RT_PATH,
    )?.payload;

    expect(payload?.format).toBe("md");
    const reviewText = payload?.reviewText ?? "";

    // One deterministic normalized order, with inline markup flattened.
    expect(reviewText).toBe(EXPECTED_REVIEW_TEXT);
    expect(reviewText).not.toContain("**");
    expect(reviewText).not.toContain("_Frumious_");

    // Derived from the exact head, not the base revision or the source diff.
    expect(reviewText).toContain("Bandersnatch");
    expect(reviewText).not.toContain("Baseonly");
    expect(reviewText).not.toContain("Manxome");

    // Blocks appear in the head's reading order.
    expect(reviewText.indexOf("Zylographic")).toBeLessThan(
      reviewText.indexOf("Bandersnatch"),
    );
    expect(reviewText.indexOf("Bandersnatch")).toBeLessThan(
      reviewText.indexOf("Vorpalsentinel"),
    );
  });
});

// The #37 gate (md source diff): a modified md file whose base and head place unique
// text on DIFFERENT lines. The line-addressable source diff must retain the exact
// word diff and rendered head (unchanged) while numbering each line: a removed-only
// line (`Xreptalon`) carries a base number but NO head number, added lines carry a
// head number, and a shifted context line (`gamma line`) carries both, with its head
// number offset from its base number by the net insertion above it.
describe("GET /pr/:owner/:repo/:number (md source-diff seam)", () => {
  let app: INestApplication | undefined;

  const SRC_NUMBER = 8;
  const SRC_PATH = "deliverables/notes.md";
  // base lines: 1 "# Report", 2 "alpha line", 3 "Xreptalon holds", 4 "gamma line".
  const SRC_BASE = [
    "# Report",
    "alpha line",
    "Xreptalon holds",
    "gamma line",
  ].join("\n");
  // head lines: 1 "# Report", 2 "alpha line", 3 "Qwybalon holds",
  // 4 "delta added line", 5 "gamma line".
  const SRC_HEAD = [
    "# Report",
    "alpha line",
    "Qwybalon holds",
    "delta added line",
    "gamma line",
  ].join("\n");

  const srcMeta: PullRequestMetadata = {
    ...meta,
    number: SRC_NUMBER,
    branch: "agent/notes",
    baseBranch: "main",
  };

  const srcFake = (): FakeGitHubSource => {
    const fake = new FakeGitHubSource();
    fake.setPullRequest(SLUG, srcMeta);
    fake.setChangedFiles(SLUG, SRC_NUMBER, [
      { path: SRC_PATH, status: "modified" },
    ]);
    fake.setBlob(
      SLUG,
      srcMeta.headSha,
      blob(SRC_PATH, srcMeta.headSha, SRC_HEAD),
    );
    fake.setBlob(
      SLUG,
      srcMeta.baseBranch,
      blob(SRC_PATH, srcMeta.baseBranch, SRC_BASE),
    );
    return fake;
  };

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("retains the word diff and rendered head while adding a correctly numbered source diff", async () => {
    app = await buildApp(srcFake());
    await reconcileReview(app, `/pr/${SLUG}/${SRC_NUMBER}`);

    const response = await request(app.getHttpServer())
      .get(`/pr/${SLUG}/${SRC_NUMBER}`)
      .expect(200);
    const payload = (response.body as ReviewBody).data.files.find(
      (file) => file.path === SRC_PATH,
    )?.payload;

    expect(payload?.format).toBe("md");

    // The exact word diff remains - a total check, not substrings: dropping the
    // added segments must reconstruct the base verbatim, and dropping the removed
    // segments must reconstruct the head verbatim. Any missing, extra, or
    // misclassified segment breaks one reconstruction, so this catches what a
    // per-word substring assertion would miss.
    const diff = payload?.diff ?? [];
    const reconstruct = (drop: "added" | "removed") =>
      diff
        .filter((segment) => segment[drop] !== true)
        .map((segment) => segment.value)
        .join("");
    expect(reconstruct("added")).toBe(SRC_BASE);
    expect(reconstruct("removed")).toBe(SRC_HEAD);
    // ...and the changed words are classified on the correct side.
    expect(
      diff.some((s) => s.removed === true && s.value.includes("Xreptalon")),
    ).toBe(true);
    expect(
      diff.some((s) => s.added === true && s.value.includes("Qwybalon")),
    ).toBe(true);
    // The rendered head remains HTML of the head content.
    expect(payload?.renderedHead).toContain("<h1>Report</h1>");

    const sourceDiff = payload?.sourceDiff ?? [];

    // The removed-only line carries a base number but no head anchor.
    const removed = sourceDiff.find((line) => line.text === "Xreptalon holds");
    expect(removed?.change).toBe("removed");
    expect(removed?.oldLine).toBe(3);
    expect(removed?.newLine).toBeUndefined();

    // The added line carries a positive head number and no base number.
    const addedLine = sourceDiff.find(
      (line) => line.text === "delta added line",
    );
    expect(addedLine?.change).toBe("added");
    expect(addedLine?.newLine).toBe(4);
    expect(addedLine?.oldLine).toBeUndefined();

    // The shifted context line carries both, with base 4 -> head 5 (one net insert).
    const context = sourceDiff.find((line) => line.text === "gamma line");
    expect(context?.change).toBe("context");
    expect(context?.oldLine).toBe(4);
    expect(context?.newLine).toBe(5);
  });
});

// The #9 gate: a modified canonical .docx whose HEAD bytes are a REAL .docx (a ZIP of
// XML parts, built deterministically in the test with no zip dependency). Its body
// carries `Zphlorbunq42Marker`, a counter-fixture that appears nowhere else in the
// inputs, so the payload's server-converted HTML must contain it - and the docx arm
// carries only `renderedHead`, no diff (the content diff lives in the md mirror).
describe("GET /pr/:owner/:repo/:number (docx renderer seam)", () => {
  let app: INestApplication | undefined;

  const DOCX_NUMBER = 9;
  const DOCX_PATH = "deliverables/memo.docx";
  const DOCX_MARKER = "Zphlorbunq42Marker";

  const docxMeta: PullRequestMetadata = {
    ...meta,
    number: DOCX_NUMBER,
    branch: "agent/memo",
    baseBranch: "main",
  };

  const docxFake = (): FakeGitHubSource => {
    const fake = new FakeGitHubSource();
    fake.setPullRequest(SLUG, docxMeta);
    fake.setChangedFiles(SLUG, DOCX_NUMBER, [
      { path: DOCX_PATH, status: "modified" },
    ]);
    // Seed the HEAD blob as a real .docx whose body is the unique marker. The docx
    // renderer fetches only the head (no base - there is no diff), so no base blob.
    fake.setBlob(SLUG, docxMeta.headSha, {
      path: DOCX_PATH,
      ref: docxMeta.headSha,
      bytes: buildMinimalDocx(DOCX_MARKER),
    });
    return fake;
  };

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("converts the head docx to HTML containing its unique text, with no diff", async () => {
    app = await buildApp(docxFake());
    await reconcileReview(app, `/pr/${SLUG}/${DOCX_NUMBER}`);

    const response = await request(app.getHttpServer())
      .get(`/pr/${SLUG}/${DOCX_NUMBER}`)
      .expect(200);
    const payload = (response.body as ReviewBody).data.files.find(
      (file) => file.path === DOCX_PATH,
    )?.payload;

    expect(payload?.format).toBe("docx");
    // The server-converted HTML carries the counter-fixture text.
    expect(payload?.renderedHead).toContain(DOCX_MARKER);
    // The docx arm has renderedHead only - no diff.
    expect(payload && "diff" in payload).toBe(false);
    expect(payload?.diff).toBeUndefined();
  });
});

// The #10 gate (html arm): a modified .html file whose HEAD contains a `<script>`
// and `Vrelquorbin88Marker`, a counter-fixture that appears nowhere else. The html
// arm ships the RAW content unmodified, so the payload's `raw` must include the
// marker (proving the server does not strip; the comparison route constrains browsing).
// #37
// adds a line-addressable source diff (base -> head): the raw head stays byte-for-
// byte while the numbered source diff carries the marker and the script text on
// their head lines. The base differs from the head on the head/body lines, so the
// diff plants added lines (with head numbers) and removed lines (with none).
describe("GET /pr/:owner/:repo/:number (html renderer seam)", () => {
  let app: INestApplication | undefined;

  const HTML_NUMBER = 10;
  const HTML_PATH = "sources/research.html";
  const HTML_MARKER = "Vrelquorbin88Marker";
  const HTML_SCRIPT = "window.__x=1;";
  const HTML_HEAD = [
    "<!doctype html>",
    "<html>",
    `<head><script>${HTML_SCRIPT}</script></head>`,
    `<body><p>${HTML_MARKER}</p></body>`,
    "</html>",
  ].join("\n");
  const HTML_BASE = [
    "<!doctype html>",
    "<html>",
    "<head></head>",
    "<body><p>Old research</p></body>",
    "</html>",
  ].join("\n");

  const htmlMeta: PullRequestMetadata = {
    ...meta,
    number: HTML_NUMBER,
    branch: "agent/research",
    baseBranch: "main",
  };

  const htmlFake = (): FakeGitHubSource => {
    const fake = new FakeGitHubSource();
    fake.setPullRequest(SLUG, htmlMeta);
    fake.setChangedFiles(SLUG, HTML_NUMBER, [
      { path: HTML_PATH, status: "modified" },
    ]);
    fake.setBlob(
      SLUG,
      htmlMeta.headSha,
      blob(HTML_PATH, htmlMeta.headSha, HTML_HEAD),
    );
    fake.setBlob(
      SLUG,
      htmlMeta.baseBranch,
      blob(HTML_PATH, htmlMeta.baseBranch, HTML_BASE),
    );
    return fake;
  };

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("ships the html file's raw content unmodified (scripts not stripped)", async () => {
    app = await buildApp(htmlFake());
    await reconcileReview(app, `/pr/${SLUG}/${HTML_NUMBER}`);

    const response = await request(app.getHttpServer())
      .get(`/pr/${SLUG}/${HTML_NUMBER}`)
      .expect(200);
    const payload = (response.body as ReviewBody).data.files.find(
      (file) => file.path === HTML_PATH,
    )?.payload;

    expect(payload?.format).toBe("html");
    // The raw content carries the counter-fixture marker and the <script> intact,
    // byte-for-byte (the head text, unmodified).
    expect(payload?.raw).toBe(HTML_HEAD);
    expect(payload?.raw).toContain(HTML_MARKER);
    expect(payload?.raw).toContain("<script>");
  });

  it("serves the exact authored HTML behind a no-egress browsing policy", async () => {
    const fake = htmlFake();
    app = await buildApp(fake);
    await reconcileReview(app, `/pr/${SLUG}/${HTML_NUMBER}`);

    const surface = await request(app.getHttpServer())
      .get(`/pr/${SLUG}/${HTML_NUMBER}`)
      .expect(200);
    const payload = (surface.body as ReviewBody).data.files.find(
      (file) => file.path === HTML_PATH,
    )?.payload;

    expect(payload?.format).toBe("html");
    const comparisonUrl = payload?.comparisonUrl ?? "";
    expect(comparisonUrl).toBe(
      `/pr/${SLUG}/${HTML_NUMBER}/raw?path=${encodeURIComponent(HTML_PATH)}&ref=${htmlMeta.headSha}`,
    );

    // Advance the live PR after the surface was assembled. The comparison URL must stay
    // pinned to the exact head that produced the raw copy and source diff above.
    const nextHeadSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    fake.setPullRequest(SLUG, { ...htmlMeta, headSha: nextHeadSha });
    fake.setBlob(
      SLUG,
      nextHeadSha,
      blob(HTML_PATH, nextHeadSha, "<p>Later head must not render</p>"),
    );

    const comparison = await request(app.getHttpServer())
      .get(comparisonUrl)
      .expect(200);
    expect(comparison.headers["content-type"]).toContain(
      "text/html; charset=utf-8",
    );
    expect(comparison.headers["content-security-policy"]).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'; sandbox",
    );
    expect(comparison.headers["content-disposition"]).toBeUndefined();
    expect(comparison.text).toBe(HTML_HEAD);
  });

  it("rejects a raw ref that is not owned by this PR's review history", async () => {
    const unrelatedHead = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const fake = htmlFake();
    fake.setBlob(
      SLUG,
      unrelatedHead,
      blob(HTML_PATH, unrelatedHead, "<p>Unreviewed repository content</p>"),
    );
    app = await buildApp(fake);
    await reconcileReview(app, `/pr/${SLUG}/${HTML_NUMBER}`);

    await request(app.getHttpServer())
      .get(
        `/pr/${SLUG}/${HTML_NUMBER}/raw?path=${encodeURIComponent(HTML_PATH)}&ref=${unrelatedHead}`,
      )
      .expect(400);
  });

  it("adds a numbered source diff preserving the marker and script text on their head lines", async () => {
    app = await buildApp(htmlFake());
    await reconcileReview(app, `/pr/${SLUG}/${HTML_NUMBER}`);

    const response = await request(app.getHttpServer())
      .get(`/pr/${SLUG}/${HTML_NUMBER}`)
      .expect(200);
    const payload = (response.body as ReviewBody).data.files.find(
      (file) => file.path === HTML_PATH,
    )?.payload;

    expect(payload?.format).toBe("html");
    const sourceDiff = payload?.sourceDiff ?? [];

    // The line carrying the unique marker is an added head line with a positive
    // head number that preserves the marker text.
    const markerLine = sourceDiff.find((line) =>
      line.text.includes(HTML_MARKER),
    );
    expect(markerLine?.change).toBe("added");
    expect(markerLine?.newLine).toBe(4);
    expect(markerLine?.oldLine).toBeUndefined();

    // The embedded script text is preserved on its own numbered head line.
    const scriptLine = sourceDiff.find((line) =>
      line.text.includes(HTML_SCRIPT),
    );
    expect(scriptLine?.change).toBe("added");
    expect(scriptLine?.newLine).toBe(3);

    // The base-only <head></head> line is removed context: no head anchor.
    const removedLine = sourceDiff.find(
      (line) => line.text === "<head></head>",
    );
    expect(removedLine?.change).toBe("removed");
    expect(removedLine?.newLine).toBeUndefined();
    expect(removedLine?.oldLine).toBe(3);
  });

  it("omits the authored comparison when a deleted HTML file has no exact head", async () => {
    const deletedNumber = 78;
    const deletedMeta = {
      ...htmlMeta,
      number: deletedNumber,
      branch: "agent/delete-research",
    };
    const fake = new FakeGitHubSource();
    fake.setPullRequest(SLUG, deletedMeta);
    fake.setChangedFiles(SLUG, deletedNumber, [
      { path: HTML_PATH, status: "removed" },
    ]);
    fake.setBlob(
      SLUG,
      deletedMeta.baseBranch,
      blob(HTML_PATH, deletedMeta.baseBranch, HTML_BASE),
    );
    app = await buildApp(fake);
    await reconcileReview(app, `/pr/${SLUG}/${deletedNumber}`);

    const response = await request(app.getHttpServer())
      .get(`/pr/${SLUG}/${deletedNumber}`)
      .expect(200);
    const payload = (response.body as ReviewBody).data.files[0]?.payload;

    expect(payload?.format).toBe("html");
    expect(payload?.raw).toBe("");
    expect(payload?.comparisonUrl).toBeNull();
  });
});

// The #10 gate (pdf arm + blob-serving route): a modified .pdf file yields a `pdf`
// payload pointing at the blob route; fetching that blobUrl streams the head bytes
// with an `application/pdf` content type derived from the .pdf extension.
describe("GET /pr/:owner/:repo/:number (pdf renderer seam + raw route)", () => {
  let app: INestApplication | undefined;

  const PDF_NUMBER = 11;
  const PDF_PATH = "sources/prospectus.pdf";
  const PDF_BYTES = Buffer.from(
    "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
    "latin1",
  );

  const pdfMeta: PullRequestMetadata = {
    ...meta,
    number: PDF_NUMBER,
    branch: "agent/prospectus",
    baseBranch: "main",
  };

  const pdfFake = (): FakeGitHubSource => {
    const fake = new FakeGitHubSource();
    fake.setPullRequest(SLUG, pdfMeta);
    fake.setChangedFiles(SLUG, PDF_NUMBER, [
      { path: PDF_PATH, status: "modified" },
    ]);
    fake.setBlob(SLUG, pdfMeta.headSha, {
      path: PDF_PATH,
      ref: pdfMeta.headSha,
      bytes: PDF_BYTES,
    });
    return fake;
  };

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("yields a pdf payload whose blob URL serves application/pdf", async () => {
    app = await buildApp(pdfFake());
    await reconcileReview(app, `/pr/${SLUG}/${PDF_NUMBER}`);

    const surface = await request(app.getHttpServer())
      .get(`/pr/${SLUG}/${PDF_NUMBER}`)
      .expect(200);
    const payload = (surface.body as ReviewBody).data.files.find(
      (file) => file.path === PDF_PATH,
    )?.payload;

    expect(payload?.format).toBe("pdf");
    const blobUrl = payload?.blobUrl ?? "";
    expect(blobUrl).toBeTruthy();

    // Fetching the blob URL streams the head bytes with a pdf content type.
    const raw = await request(app.getHttpServer())
      .get(blobUrl)
      .buffer(true)
      .expect(200);
    expect(raw.headers["content-type"]).toContain("application/pdf");
    expect(raw.headers["content-disposition"]).toBeUndefined();
  });

  it("serves raw files without requiring writable review-state storage", async () => {
    const statePath = createTestStatePath();
    await mkdir(statePath);
    app = await buildApp(pdfFake(), statePath);

    const raw = await request(app.getHttpServer())
      .get(`/pr/${SLUG}/${PDF_NUMBER}/raw?path=${encodeURIComponent(PDF_PATH)}`)
      .buffer(true)
      .expect(200);

    expect(raw.headers["content-type"]).toContain("application/pdf");
  });
});

// The #43 gate: GitHub collapses `renamed`/`copied` to `modified`, so a renamed
// file's base blob lives at its PREVIOUS path, not its new path. The review surface
// must diff the base at `previousPath`; before the fix it fetched the base at the new
// path, where it does not exist, so the real source's non-200 rejected the whole PR
// (~500). Each fixture stages the base ONLY at the previous path and the head at the
// new path, with counter-fixture words that appear nowhere else.
describe("GET /pr/:owner/:repo/:number (renamed base at previous path)", () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  const renameMeta = (number: number, branch: string): PullRequestMetadata => ({
    ...meta,
    number,
    branch,
    baseBranch: "main",
  });

  it("diffs a renamed md file against the base at its previous path", async () => {
    const RENAME_MD_NUMBER = 12;
    const OLD_PATH = "docs/old-report.md";
    const NEW_PATH = "docs/new-report.md";
    const BASE_MD = "# Doc\n\nThe Blorptaxus figure stands.\n";
    const HEAD_MD = "# Doc\n\nThe **Grindlewax** figure stands.\n";
    const renameMdMeta = renameMeta(RENAME_MD_NUMBER, "agent/rename-md");

    const fake = new FakeGitHubSource();
    fake.setPullRequest(SLUG, renameMdMeta);
    fake.setChangedFiles(SLUG, RENAME_MD_NUMBER, [
      { path: NEW_PATH, status: "renamed", previousPath: OLD_PATH },
    ]);
    // The head lives at the NEW path; the base lives ONLY at the previous path.
    fake.setBlob(
      SLUG,
      renameMdMeta.headSha,
      blob(NEW_PATH, renameMdMeta.headSha, HEAD_MD),
    );
    fake.setBlob(
      SLUG,
      renameMdMeta.baseBranch,
      blob(OLD_PATH, renameMdMeta.baseBranch, BASE_MD),
    );

    app = await buildApp(fake);
    await reconcileReview(app, `/pr/${SLUG}/${RENAME_MD_NUMBER}`);

    const response = await request(app.getHttpServer())
      .get(`/pr/${SLUG}/${RENAME_MD_NUMBER}`)
      .expect(200);
    const body = response.body as ReviewBody;

    // The whole surface assembles and conforms to the wire contract.
    expect(reviewSurfaceResponseSchema.safeParse(body.data).success).toBe(true);
    expect(body.data.files.map((file) => file.path)).toEqual([NEW_PATH]);

    const payload = body.data.files.find(
      (file) => file.path === NEW_PATH,
    )?.payload;
    expect(payload?.format).toBe("md");

    // The word diff reflects base (previous path) -> head (new path): the base-only
    // word is removed, the head-only word added.
    const diff = payload?.diff ?? [];
    const removed = diff
      .filter((segment) => segment.removed)
      .map((segment) => segment.value)
      .join("");
    const added = diff
      .filter((segment) => segment.added)
      .map((segment) => segment.value)
      .join("");
    expect(removed).toContain("Blorptaxus");
    expect(added).toContain("Grindlewax");
    expect(payload?.renderedHead).toContain("<strong>Grindlewax</strong>");

    // The line-addressable source diff is base (previous path) -> head (new path):
    // the base-only word sits on a removed line, the head-only word on an added line.
    const sourceDiff = payload?.sourceDiff ?? [];
    const removedLine = sourceDiff.find((line) =>
      line.text.includes("Blorptaxus"),
    );
    expect(removedLine?.change).toBe("removed");
    const addedLine = sourceDiff.find((line) =>
      line.text.includes("Grindlewax"),
    );
    expect(addedLine?.change).toBe("added");
  });

  it("diffs a renamed html file against the base at its previous path", async () => {
    const RENAME_HTML_NUMBER = 13;
    const OLD_PATH = "pages/old.html";
    const NEW_PATH = "pages/new.html";
    const HTML_MARKER = "Sprocketvane77Marker";
    const HEAD_HTML = [
      "<!doctype html>",
      "<html>",
      "<head></head>",
      `<body><p>${HTML_MARKER}</p></body>`,
      "</html>",
    ].join("\n");
    const BASE_HTML = [
      "<!doctype html>",
      "<html>",
      "<head></head>",
      "<body><p>Old Wexlorbin content</p></body>",
      "</html>",
    ].join("\n");
    const renameHtmlMeta = renameMeta(RENAME_HTML_NUMBER, "agent/rename-html");

    const fake = new FakeGitHubSource();
    fake.setPullRequest(SLUG, renameHtmlMeta);
    fake.setChangedFiles(SLUG, RENAME_HTML_NUMBER, [
      { path: NEW_PATH, status: "renamed", previousPath: OLD_PATH },
    ]);
    fake.setBlob(
      SLUG,
      renameHtmlMeta.headSha,
      blob(NEW_PATH, renameHtmlMeta.headSha, HEAD_HTML),
    );
    fake.setBlob(
      SLUG,
      renameHtmlMeta.baseBranch,
      blob(OLD_PATH, renameHtmlMeta.baseBranch, BASE_HTML),
    );

    app = await buildApp(fake);
    await reconcileReview(app, `/pr/${SLUG}/${RENAME_HTML_NUMBER}`);

    const response = await request(app.getHttpServer())
      .get(`/pr/${SLUG}/${RENAME_HTML_NUMBER}`)
      .expect(200);
    const body = response.body as ReviewBody;

    expect(reviewSurfaceResponseSchema.safeParse(body.data).success).toBe(true);
    expect(body.data.files.map((file) => file.path)).toEqual([NEW_PATH]);

    const payload = body.data.files.find(
      (file) => file.path === NEW_PATH,
    )?.payload;
    expect(payload?.format).toBe("html");
    // The raw head is the head content byte-for-byte.
    expect(payload?.raw).toBe(HEAD_HTML);

    // The source diff is base (previous path) -> head (new path): the head-only
    // marker line is added, the base-only content line removed.
    const sourceDiff = payload?.sourceDiff ?? [];
    const markerLine = sourceDiff.find((line) =>
      line.text.includes(HTML_MARKER),
    );
    expect(markerLine?.change).toBe("added");
    const removedLine = sourceDiff.find((line) =>
      line.text.includes("Wexlorbin"),
    );
    expect(removedLine?.change).toBe("removed");
  });

  it("returns 200 with every file present when a renamed file is among the changes", async () => {
    const MIXED_NUMBER = 14;
    const RENAMED_PATH = "docs/renamed.md";
    const RENAMED_PREV = "docs/original.md";
    const MODIFIED_PATH = "docs/kept.md";
    const mixedMeta = renameMeta(MIXED_NUMBER, "agent/mixed");

    const fake = new FakeGitHubSource();
    fake.setPullRequest(SLUG, mixedMeta);
    fake.setChangedFiles(SLUG, MIXED_NUMBER, [
      { path: RENAMED_PATH, status: "renamed", previousPath: RENAMED_PREV },
      { path: MODIFIED_PATH, status: "modified" },
    ]);
    // Renamed: base only at the previous path, head at the new path.
    fake.setBlob(
      SLUG,
      mixedMeta.headSha,
      blob(RENAMED_PATH, mixedMeta.headSha, "# Renamed\n\nHead.\n"),
    );
    fake.setBlob(
      SLUG,
      mixedMeta.baseBranch,
      blob(RENAMED_PREV, mixedMeta.baseBranch, "# Renamed\n\nBase.\n"),
    );
    // Modified: both sides at the same path.
    fake.setBlob(
      SLUG,
      mixedMeta.headSha,
      blob(MODIFIED_PATH, mixedMeta.headSha, "# Kept\n\nHead.\n"),
    );
    fake.setBlob(
      SLUG,
      mixedMeta.baseBranch,
      blob(MODIFIED_PATH, mixedMeta.baseBranch, "# Kept\n\nBase.\n"),
    );

    app = await buildApp(fake);
    await reconcileReview(app, `/pr/${SLUG}/${MIXED_NUMBER}`);

    const response = await request(app.getHttpServer())
      .get(`/pr/${SLUG}/${MIXED_NUMBER}`)
      .expect(200);
    const files = (response.body as ReviewBody).data.files;

    // No whole-surface 500: every changed file is present, in order.
    expect(files.map((file) => file.path)).toEqual([
      RENAMED_PATH,
      MODIFIED_PATH,
    ]);
  });
});

describe("ReviewController route surface", () => {
  it("declares the read handlers, feedback creation, and the round transitions", () => {
    const handlers = Object.getOwnPropertyNames(
      ReviewController.prototype,
    ).filter((name) => name !== "constructor");
    expect(handlers).toEqual([
      "getReviewSurface",
      "reconcileReview",
      "getRawFile",
      "createFeedback",
      "transitionRound",
      "resolveComment",
      "getCurrentArtifact",
    ]);
  });
});
