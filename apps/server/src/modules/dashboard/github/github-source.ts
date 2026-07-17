import type { PullRequestListItem } from "@doc-review/api-contracts";

// GitHub's per-file change status on a pull request
// (https://docs.github.com/rest/pulls/pulls#list-pull-requests-files).
export type GitHubFileStatus =
  | "added"
  | "removed"
  | "modified"
  | "renamed"
  | "copied"
  | "changed"
  | "unchanged";

// One changed file in a PR. Consumed by later issues (the review surface); #6
// only wires `listOpenPullRequests` end to end. `previousPath` is GitHub's
// `previous_filename`: the file's path on the base side of a rename/copy (set only
// for those statuses), so the review surface can diff the base at where it exists.
export type ChangedFile = {
  path: string;
  status: GitHubFileStatus;
  previousPath?: string;
};

// A file's raw bytes at a ref. Kept as a Buffer so binary canonicals (docx, pdf)
// survive intact; text renderers decode as needed. Consumed by later issues.
export type FileBlob = {
  path: string;
  ref: string;
  bytes: Buffer;
};

// A single PR's metadata for the review surface. Unlike `listOpenPullRequests`,
// this carries the PR `description` (the agent's own account of the change), which
// the list view does not need. `htmlUrl` is the PR's GitHub page (the deep link);
// `branch` is the head ref and `baseBranch` the base ref (the diff's before side,
// which the md renderer fetches base blobs at). `headSha` is the immutable commit
// identity used to key retained review rounds.
export type PullRequestMetadata = {
  number: number;
  title: string;
  description: string;
  branch: string;
  headSha: string;
  baseBranch: string;
  merged: boolean;
  author: string;
  createdAt: string;
  htmlUrl: string;
};

/**
 * The single seam through which the app reads GitHub. Every GitHub read goes
 * through these operations; nothing else talks to GitHub directly. Declared
 * as an abstract class so it doubles as a Nest DI token (provided by the real
 * `fetch` implementation, overridden by the in-memory fake in tests).
 */
export abstract class GitHubSource {
  abstract listOpenPullRequests(repo: string): Promise<PullRequestListItem[]>;
  abstract getPullRequest(
    repo: string,
    prNumber: number,
  ): Promise<PullRequestMetadata>;
  abstract listChangedFiles(
    repo: string,
    prNumber: number,
  ): Promise<ChangedFile[]>;
  abstract fetchBlob(
    repo: string,
    ref: string,
    path: string,
  ): Promise<FileBlob>;
}
