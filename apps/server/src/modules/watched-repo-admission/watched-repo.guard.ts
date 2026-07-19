import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { WatchedRepoAdmissionPolicy } from "./watched-repo-admission.policy";

type RepoScopedRequest = {
  params: {
    owner: string;
    repo: string;
  };
};

@Injectable()
export class WatchedRepoGuard implements CanActivate {
  constructor(private readonly admission: WatchedRepoAdmissionPolicy) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RepoScopedRequest>();
    this.admission.assertWatched(
      `${request.params.owner}/${request.params.repo}`,
    );
    return true;
  }
}
