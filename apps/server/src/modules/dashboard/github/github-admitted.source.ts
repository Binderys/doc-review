import type { PullRequestListItem } from "@doc-review/api-contracts";
import { Inject, Injectable } from "@nestjs/common";
import { WatchedRepoAdmissionPolicy } from "../../watched-repo-admission/watched-repo-admission.policy";
import { GITHUB_SOURCE_BACKEND } from "./github-source-backend";
import {
  GitHubSource,
  type ChangedFile,
  type FileBlob,
  type PullRequestMetadata,
} from "./github-source";

@Injectable()
export class AdmittedGitHubSource extends GitHubSource {
  constructor(
    private readonly admission: WatchedRepoAdmissionPolicy,
    @Inject(GITHUB_SOURCE_BACKEND) private readonly backend: GitHubSource,
  ) {
    super();
  }

  async listOpenPullRequests(repo: string): Promise<PullRequestListItem[]> {
    this.admission.assertWatched(repo);
    return this.backend.listOpenPullRequests(repo);
  }

  async getPullRequest(
    repo: string,
    prNumber: number,
  ): Promise<PullRequestMetadata> {
    this.admission.assertWatched(repo);
    return this.backend.getPullRequest(repo, prNumber);
  }

  async listChangedFiles(
    repo: string,
    prNumber: number,
  ): Promise<ChangedFile[]> {
    this.admission.assertWatched(repo);
    return this.backend.listChangedFiles(repo, prNumber);
  }

  async fetchBlob(repo: string, ref: string, path: string): Promise<FileBlob> {
    this.admission.assertWatched(repo);
    return this.backend.fetchBlob(repo, ref, path);
  }
}
