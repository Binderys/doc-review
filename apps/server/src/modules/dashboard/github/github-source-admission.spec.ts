import type { PullRequestListItem } from "@doc-review/api-contracts";
import { NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { AppModule } from "../../../app.module";
import { GitHubApiSource } from "./github-api.source";
import { ComposeSmokeGitHubSource } from "./github-compose-smoke.source";
import { FakeGitHubSource } from "./github-fake.source";
import { GITHUB_SOURCE_BACKEND } from "./github-source-backend";
import {
  GitHubSource,
  type ChangedFile,
  type FileBlob,
  type PullRequestMetadata,
} from "./github-source";

const LISTED_REPO = "acme/board-review";
const UNLISTED_REPO = "outside/private-documents";

const failOnCallBackend = (): {
  backend: GitHubSource;
  calls: jest.Mock[];
} => {
  const calls = [jest.fn(), jest.fn(), jest.fn(), jest.fn()];
  const fail = (): never => {
    throw new Error("GitHub backend must not be called");
  };
  for (const call of calls) {
    call.mockImplementation(fail);
  }

  return {
    backend: {
      listOpenPullRequests: calls[0] as jest.Mock<
        Promise<PullRequestListItem[]>,
        [string]
      >,
      getPullRequest: calls[1] as jest.Mock<
        Promise<PullRequestMetadata>,
        [string, number]
      >,
      listChangedFiles: calls[2] as jest.Mock<
        Promise<ChangedFile[]>,
        [string, number]
      >,
      fetchBlob: calls[3] as jest.Mock<
        Promise<FileBlob>,
        [string, string, string]
      >,
    },
    calls,
  };
};

describe("watched repo admission at the public GitHubSource binding", () => {
  let moduleRef: TestingModule | undefined;

  afterEach(async () => {
    await moduleRef?.close();
    moduleRef = undefined;
  });

  it("rejects every operation for an unlisted repo before the backend is called", async () => {
    const { backend, calls } = failOnCallBackend();
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GITHUB_SOURCE_BACKEND)
      .useValue(backend)
      .overrideProvider(ConfigService)
      .useValue({
        get: (key: string) =>
          key === "watchedRepos" ? [LISTED_REPO] : undefined,
      })
      .compile();
    const source = moduleRef.get(GitHubSource);

    const operations = [
      () => source.listOpenPullRequests(UNLISTED_REPO),
      () => source.getPullRequest(UNLISTED_REPO, 42),
      () => source.listChangedFiles(UNLISTED_REPO, 42),
      () => source.fetchBlob(UNLISTED_REPO, "head-sha", "memo.md"),
    ];

    for (const operation of operations) {
      await expect(operation()).rejects.toBeInstanceOf(NotFoundException);
      for (const call of calls) {
        expect(call).not.toHaveBeenCalled();
      }
    }
  });

  it.each([
    ["real", "github", GitHubApiSource],
    ["Compose smoke", "compose-smoke", ComposeSmokeGitHubSource],
  ] as const)(
    "wraps the selected %s backend and rejects every unlisted operation before dispatch",
    async (_name, githubSource, backendType) => {
      moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(ConfigService)
        .useValue({
          get: (key: string) => {
            if (key === "watchedRepos") {
              return [LISTED_REPO];
            }
            if (key === "githubSource") {
              return githubSource;
            }
            return undefined;
          },
        })
        .compile();
      const backend = moduleRef.get(backendType);
      const calls = [
        jest
          .spyOn(backend, "listOpenPullRequests")
          .mockRejectedValue(new Error("Backend must not be called")),
        jest
          .spyOn(backend, "getPullRequest")
          .mockRejectedValue(new Error("Backend must not be called")),
        jest
          .spyOn(backend, "listChangedFiles")
          .mockRejectedValue(new Error("Backend must not be called")),
        jest
          .spyOn(backend, "fetchBlob")
          .mockRejectedValue(new Error("Backend must not be called")),
      ];
      const source = moduleRef.get(GitHubSource);
      const operations = [
        () => source.listOpenPullRequests(UNLISTED_REPO),
        () => source.getPullRequest(UNLISTED_REPO, 42),
        () => source.listChangedFiles(UNLISTED_REPO, 42),
        () => source.fetchBlob(UNLISTED_REPO, "head-sha", "memo.md"),
      ];

      for (const operation of operations) {
        await expect(operation()).rejects.toBeInstanceOf(NotFoundException);
        for (const call of calls) {
          expect(call).not.toHaveBeenCalled();
        }
      }
    },
  );

  it("dispatches a listed repo to the selected backend", async () => {
    const backend = new FakeGitHubSource();
    const expected = [
      {
        number: 42,
        title: "Listed document PR",
        branch: "agent/listed-document",
        author: "document-agent",
        createdAt: "2026-07-19T00:00:00.000Z",
      },
    ];
    backend.stageOpenPullRequests(LISTED_REPO, expected);
    const call = jest.spyOn(backend, "listOpenPullRequests");
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GITHUB_SOURCE_BACKEND)
      .useValue(backend)
      .overrideProvider(ConfigService)
      .useValue({
        get: (key: string) =>
          key === "watchedRepos" ? [LISTED_REPO] : undefined,
      })
      .compile();

    await expect(
      moduleRef.get(GitHubSource).listOpenPullRequests(LISTED_REPO),
    ).resolves.toEqual(expected);
    expect(call).toHaveBeenCalledWith(LISTED_REPO);
  });
});
