import { Module } from "@nestjs/common";
import { DashboardController } from "./dashboard.controller";
import { DashboardService } from "./dashboard.service";
import { GitHubApiSource } from "./github/github-api.source";
import { GitHubSource } from "./github/github-source";

@Module({
  controllers: [DashboardController],
  // The GitHub source is bound to its real `fetch` implementation here and
  // overridden with the in-memory fake in tests (the single substitution seam).
  providers: [
    DashboardService,
    { provide: GitHubSource, useClass: GitHubApiSource },
  ],
  // Exported so the review-surface module reuses the same GitHub seam (and its
  // test-time override) rather than binding a second instance.
  exports: [GitHubSource],
})
export class DashboardModule {}
