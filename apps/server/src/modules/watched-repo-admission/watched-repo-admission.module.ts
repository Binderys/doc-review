import { Module } from "@nestjs/common";
import { WatchedRepoAdmissionPolicy } from "./watched-repo-admission.policy";
import { WatchedRepoGuard } from "./watched-repo.guard";

@Module({
  providers: [WatchedRepoAdmissionPolicy, WatchedRepoGuard],
  exports: [WatchedRepoAdmissionPolicy, WatchedRepoGuard],
})
export class WatchedRepoAdmissionModule {}
