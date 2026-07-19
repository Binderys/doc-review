import { Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class WatchedRepoAdmissionPolicy {
  constructor(private readonly config: ConfigService) {}

  assertWatched(repo: string): void {
    const watchedRepos = this.config.get<string[]>("watchedRepos") ?? [];
    if (!watchedRepos.includes(repo)) {
      throw new NotFoundException();
    }
  }
}
