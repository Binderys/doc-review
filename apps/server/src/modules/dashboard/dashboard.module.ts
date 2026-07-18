import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DashboardController } from "./dashboard.controller";
import { DashboardService } from "./dashboard.service";
import { GitHubApiSource } from "./github/github-api.source";
import { ComposeSmokeGitHubSource } from "./github/github-compose-smoke.source";
import { GitHubSource } from "./github/github-source";

@Module({
  controllers: [DashboardController],
  // The GitHub source is bound to its real `fetch` implementation by default.
  // Unit/e2e tests override this token, while the black-box Compose smoke selects
  // its compiled deterministic fixture through the same single substitution seam.
  providers: [
    DashboardService,
    GitHubApiSource,
    ComposeSmokeGitHubSource,
    {
      provide: GitHubSource,
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
  ],
  // Exported so the review-surface module reuses the same GitHub seam (and its
  // test-time override) rather than binding a second instance.
  exports: [GitHubSource],
})
export class DashboardModule {}
