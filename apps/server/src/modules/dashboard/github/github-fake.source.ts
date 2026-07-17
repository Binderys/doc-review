import type { PullRequestListItem } from "@doc-review/api-contracts";
import {
  GitHubSource,
  type ChangedFile,
  type FileBlob,
  type PullRequestMetadata,
} from "./github-source";

/**
 * In-memory GitHub source for tests: the single DI substitution seam, so tests
 * never touch the network or real confidential content. Open-PR responses are staged as an
 * ordered sequence of snapshots per repo, so a test can prove the reload gate -
 * successive `listOpenPullRequests` calls return a different set. The last staged
 * snapshot repeats for any further calls.
 */
export class FakeGitHubSource extends GitHubSource {
  private readonly pullRequestSnapshots = new Map<
    string,
    PullRequestListItem[][]
  >();
  private readonly pullRequests = new Map<string, PullRequestMetadata>();
  private readonly changedFiles = new Map<string, ChangedFile[]>();
  private readonly blobs = new Map<string, FileBlob>();

  /**
   * Stage one or more successive open-PR snapshots for a repo. Call N returns
   * snapshot N (1-indexed); once the last snapshot is reached it repeats.
   */
  stageOpenPullRequests(
    repo: string,
    ...snapshots: PullRequestListItem[][]
  ): void {
    this.pullRequestSnapshots.set(repo, [...snapshots]);
  }

  setPullRequest(repo: string, meta: PullRequestMetadata): void {
    this.pullRequests.set(`${repo}#${meta.number}`, meta);
  }

  setChangedFiles(repo: string, prNumber: number, files: ChangedFile[]): void {
    this.changedFiles.set(`${repo}#${prNumber}`, files);
  }

  setBlob(repo: string, ref: string, blob: FileBlob): void {
    this.blobs.set(`${repo}@${ref}:${blob.path}`, blob);
  }

  listOpenPullRequests(repo: string): Promise<PullRequestListItem[]> {
    const snapshots = this.pullRequestSnapshots.get(repo);
    if (!snapshots || snapshots.length === 0) {
      return Promise.resolve([]);
    }

    // Advance through staged snapshots; hold on the last one for later calls.
    const next = snapshots.length > 1 ? snapshots.shift() : snapshots[0];
    return Promise.resolve(next ?? []);
  }

  getPullRequest(repo: string, prNumber: number): Promise<PullRequestMetadata> {
    const meta = this.pullRequests.get(`${repo}#${prNumber}`);
    if (!meta) {
      return Promise.reject(
        new Error(`No staged pull request for ${repo}#${prNumber}`),
      );
    }
    return Promise.resolve(meta);
  }

  listChangedFiles(repo: string, prNumber: number): Promise<ChangedFile[]> {
    return Promise.resolve(this.changedFiles.get(`${repo}#${prNumber}`) ?? []);
  }

  fetchBlob(repo: string, ref: string, path: string): Promise<FileBlob> {
    const blob = this.blobs.get(`${repo}@${ref}:${path}`);
    if (!blob) {
      return Promise.reject(
        new Error(`No staged blob for ${repo}@${ref}:${path}`),
      );
    }
    return Promise.resolve(blob);
  }
}
