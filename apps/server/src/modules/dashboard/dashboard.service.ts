import type {
  DashboardRepo,
  DashboardResponse,
  DashboardUnavailableReason,
} from "@doc-review/api-contracts";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GitHubApiError } from "./github/github-api.error";
import { GitHubSource } from "./github/github-source";

function unavailableReason(error: unknown): DashboardUnavailableReason {
  if (!(error instanceof GitHubApiError)) {
    return "github-unavailable";
  }

  if (
    error.status === 429 ||
    (error.status === 403 &&
      (error.retryAfterSeconds !== undefined || error.rateLimitRemaining === 0))
  ) {
    return "rate-limited";
  }

  if (error.status === 401 || error.status === 403 || error.status === 404) {
    return "access";
  }

  return "github-unavailable";
}

function safeProviderMetadata(error: unknown): Record<string, string | number> {
  if (!(error instanceof GitHubApiError)) {
    return {};
  }

  const metadata: Record<string, string | number> = {
    providerStatus: error.status,
  };
  if (error.code !== undefined) metadata.providerCode = error.code;
  if (error.documentationUrl !== undefined) {
    metadata.documentationUrl = error.documentationUrl;
  }
  if (error.retryAfterSeconds !== undefined) {
    metadata.retryAfterSeconds = error.retryAfterSeconds;
  }
  if (error.rateLimitRemaining !== undefined) {
    metadata.rateLimitRemaining = error.rateLimitRemaining;
  }
  if (error.rateLimitResetEpochSeconds !== undefined) {
    metadata.rateLimitResetEpochSeconds = error.rateLimitResetEpochSeconds;
  }
  if (error.requestId !== undefined) metadata.requestId = error.requestId;
  return metadata;
}

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

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
      watchedRepos.map((repo) => this.settleRepo(repo)),
    );

    return { repos };
  }

  private async settleRepo(repo: string): Promise<DashboardRepo> {
    try {
      return {
        repo,
        status: "available",
        pullRequests: await this.source.listOpenPullRequests(repo),
      };
    } catch (error) {
      const reason = unavailableReason(error);
      const [resourceOwner] = repo.split("/");
      this.logger.error({
        event: "dashboard watched repo unavailable",
        repo,
        resourceOwner,
        reason,
        ...safeProviderMetadata(error),
      });
      return { repo, status: "unavailable", reason };
    }
  }
}
