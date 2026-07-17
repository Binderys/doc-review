import { FakeGitHubSource } from "../../src/modules/dashboard/github/github-fake.source";
import type { PullRequestMetadata } from "../../src/modules/dashboard/github/github-source";
import { buildMinimalDocx } from "./minimal-docx";

export const REVIEW_LOOP = {
  owner: "acme",
  repo: "review-loop-fixture",
  number: 38,
  headSha: "1234567890abcdef1234567890abcdef12345678",
  secondHeadSha: "abcdef1234567890abcdef1234567890abcdef12",
  branch: "agent/document-round-two",
  mirrorPath: "deliverables/board-memo.md",
  canonicalPath: "deliverables/board-memo.docx",
  htmlPath: "sources/appendix.htm",
  pdfPath: "deliverables/board-pack.pdf",
  mirrorHead: [
    "# Board memo",
    "",
    "The Quillibrium result is ready.",
    "Keep this exact second range line.",
  ].join("\r\n"),
  htmlHead: [
    "<!doctype html>",
    "<html>",
    "<body><p>Exact Spindlewick source line.</p></body>",
    "</html>",
  ].join("\r\n"),
  secondMirrorHead: [
    "# Board memo",
    "",
    "The Quillibrium result is ready.",
    "Inserted before the moved quote.",
    "Keep this exact second range line.",
  ].join("\n"),
  secondHtmlHead: [
    "<!doctype html>",
    "<html>",
    "<body><p>Exact Spindlewick source line.</p></body>",
    "<footer>Second-head context.</footer>",
    "</html>",
  ].join("\n"),
  pdfBytes: Buffer.from(
    "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
    "latin1",
  ),
} as const;

export const reviewLoopMetadata = (
  headSha: string = REVIEW_LOOP.headSha,
): PullRequestMetadata => {
  const fixture = REVIEW_LOOP;
  const slug = `${fixture.owner}/${fixture.repo}`;
  return {
    number: fixture.number,
    title: "Board memo review loop",
    description: "A real Canonical and Mirror review fixture.",
    branch: fixture.branch,
    headSha,
    baseBranch: "main",
    merged: false,
    author: "board-agent",
    createdAt: "2026-07-13T00:00:00.000Z",
    htmlUrl: `https://github.com/${slug}/pull/${fixture.number}`,
  };
};

export const stageReviewLoop = (): FakeGitHubSource => {
  const fixture = REVIEW_LOOP;
  const slug = `${fixture.owner}/${fixture.repo}`;
  const meta = reviewLoopMetadata();

  const fake = new FakeGitHubSource();
  fake.setPullRequest(slug, meta);
  fake.setChangedFiles(slug, fixture.number, [
    { path: fixture.canonicalPath, status: "modified" },
    { path: fixture.mirrorPath, status: "modified" },
    { path: fixture.htmlPath, status: "modified" },
    { path: fixture.pdfPath, status: "modified" },
  ]);

  const setTextBlob = (path: string, ref: string, text: string): void => {
    fake.setBlob(slug, ref, {
      path,
      ref,
      bytes: Buffer.from(text, "utf8"),
    });
  };

  for (const ref of [fixture.branch, fixture.headSha]) {
    setTextBlob(fixture.mirrorPath, ref, fixture.mirrorHead);
    setTextBlob(fixture.htmlPath, ref, fixture.htmlHead);
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
      bytes: fixture.pdfBytes,
    });
  }

  setTextBlob(fixture.mirrorPath, meta.baseBranch, "# Board memo\n\nOld copy.");
  setTextBlob(
    fixture.htmlPath,
    meta.baseBranch,
    "<!doctype html>\n<html>\n<body>Old source.</body>\n</html>",
  );

  return fake;
};

export const stageReviewLoopSecondHead = (fake: FakeGitHubSource): void => {
  const fixture = REVIEW_LOOP;
  const slug = `${fixture.owner}/${fixture.repo}`;
  const headSha = fixture.secondHeadSha;

  fake.setPullRequest(slug, reviewLoopMetadata(headSha));
  fake.setChangedFiles(slug, fixture.number, [
    { path: fixture.canonicalPath, status: "modified" },
    { path: fixture.mirrorPath, status: "modified" },
    { path: fixture.htmlPath, status: "modified" },
    { path: fixture.pdfPath, status: "modified" },
  ]);
  fake.setBlob(slug, headSha, {
    path: fixture.mirrorPath,
    ref: headSha,
    bytes: Buffer.from(fixture.secondMirrorHead, "utf8"),
  });
  fake.setBlob(slug, headSha, {
    path: fixture.htmlPath,
    ref: headSha,
    bytes: Buffer.from(fixture.secondHtmlHead, "utf8"),
  });
  fake.setBlob(slug, headSha, {
    path: fixture.canonicalPath,
    ref: headSha,
    bytes: buildMinimalDocx(
      "Recommendation. Exact nearby canonical Quasartext.",
    ),
  });
  fake.setBlob(slug, headSha, {
    path: fixture.pdfPath,
    ref: headSha,
    bytes: fixture.pdfBytes,
  });
};
