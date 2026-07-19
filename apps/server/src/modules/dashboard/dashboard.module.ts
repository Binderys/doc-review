import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { WatchedRepoAdmissionModule } from "../watched-repo-admission/watched-repo-admission.module";
import { DashboardController } from "./dashboard.controller";
import { DashboardService } from "./dashboard.service";
import { AdmittedGitHubSource } from "./github/github-admitted.source";
import { GitHubApiSource } from "./github/github-api.source";
import { ComposeSmokeGitHubSource } from "./github/github-compose-smoke.source";
import { GITHUB_SOURCE_BACKEND } from "./github/github-source-backend";
import { GitHubSource } from "./github/github-source";

@Module({
  imports: [WatchedRepoAdmissionModule],
  controllers: [DashboardController],
  // The admitted public source wraps this selected backend. Unit/e2e tests replace
  // only the backend token, while the black-box Compose smoke selects its compiled
  // deterministic fixture through the same substitution seam.
  providers: [
    DashboardService,
    GitHubApiSource,
    ComposeSmokeGitHubSource,
    {
      provide: GITHUB_SOURCE_BACKEND,
      inject: [ConfigService, GitHubApiSource, ComposeSmokeGitHubSource],
      useFactory: (
        config: ConfigService,
        github: GitHubApiSource,
        composeSmoke: ComposeSmokeGitHubSource,
      ): GitHubSource =>
        config.get<string>("githubSource", "github") === "compose-smoke"
          ? composeSmoke
          : github,
    },
    AdmittedGitHubSource,
    { provide: GitHubSource, useExisting: AdmittedGitHubSource },
  ],
  // Exported so the review-surface module reuses the admitted source rather than
  // binding a second instance.
  exports: [GitHubSource],
})
export class DashboardModule {}
