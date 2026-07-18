import { Injectable } from "@nestjs/common";
import { FakeGitHubSource } from "./github-fake.source";

const REPO = "acme/review-loop-fixture";
const PR_NUMBER = 38;
const HEAD_SHA = "1234567890abcdef1234567890abcdef12345678";
const BRANCH = "agent/document-round-two";
const BASE_BRANCH = "main";
const MIRROR_PATH = "deliverables/board-memo.md";

/**
 * Deterministic document-PR source used only by the black-box Compose smoke.
 * DashboardModule still binds the real read-only GitHub source unless the smoke's
 * disposable runtime environment explicitly selects this implementation.
 */
@Injectable()
export class ComposeSmokeGitHubSource extends FakeGitHubSource {
  constructor() {
    super();

    this.stageOpenPullRequests(REPO, [
      {
        number: PR_NUMBER,
        title: "Board memo review loop",
        branch: BRANCH,
        author: "board-agent",
        createdAt: "2026-07-13T00:00:00.000Z",
      },
    ]);
    this.setPullRequest(REPO, {
      number: PR_NUMBER,
      title: "Board memo review loop",
      description: "A controlled document PR for the Compose smoke.",
      branch: BRANCH,
      headSha: HEAD_SHA,
      baseBranch: BASE_BRANCH,
      merged: false,
      author: "board-agent",
      createdAt: "2026-07-13T00:00:00.000Z",
      htmlUrl: `https://github.com/${REPO}/pull/${PR_NUMBER}`,
    });
    this.setChangedFiles(REPO, PR_NUMBER, [
      { path: MIRROR_PATH, status: "modified" },
    ]);
    this.setBlob(REPO, HEAD_SHA, {
      path: MIRROR_PATH,
      ref: HEAD_SHA,
      bytes: Buffer.from(
        "# Board memo\n\nThe controlled Compose fixture is ready.\n",
        "utf8",
      ),
    });
    this.setBlob(REPO, BASE_BRANCH, {
      path: MIRROR_PATH,
      ref: BASE_BRANCH,
      bytes: Buffer.from("# Board memo\n\nEarlier controlled copy.\n", "utf8"),
    });
  }
}
