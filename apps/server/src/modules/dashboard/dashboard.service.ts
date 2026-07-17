import type { DashboardResponse } from "@doc-review/api-contracts";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GitHubSource } from "./github/github-source";

@Injectable()
export class DashboardService {
  constructor(
    private readonly source: GitHubSource,
    private readonly config: ConfigService,
  ) {}

  // Fetches live per request (no cross-request cache), so newly opened PRs appear
  // on reload with no restart. Watched repos are read here at request time, so a
  // config change takes effect without touching this handler.
  async getDashboard(): Promise<DashboardResponse> {
    const watchedRepos = this.config.get<string[]>("watchedRepos") ?? [];

    const repos = await Promise.all(
      watchedRepos.map(async (repo) => ({
        repo,
        pullRequests: await this.source.listOpenPullRequests(repo),
      })),
    );

    return { repos };
  }
}
