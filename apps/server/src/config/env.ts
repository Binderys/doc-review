// Launch default: the only watched repo until a fork adds more. Overridden by a
// comma-separated WATCHED_REPOS env value.
const DEFAULT_WATCHED_REPOS = ["acme/board-review"];

type ProcessEnvironment = Readonly<Record<string, string | undefined>>;

export type GitHubCredentialsByOwner = Readonly<Record<string, string>>;

export type ServerConfiguration = {
  nodeEnv: string;
  host: string;
  port: number;
  githubToken: string | undefined;
  githubCredentialsByOwner: GitHubCredentialsByOwner;
  watchedRepos: string[];
  githubSource: string;
  reviewStatePath: string;
};

export const githubCredentialEnvironmentVariable = (owner: string): string =>
  `GITHUB_TOKEN_${owner.toUpperCase().replaceAll("-", "_")}`;

export const githubResourceOwner = (repo: string): string =>
  repo.split("/", 1)[0].toLowerCase();

const parseWatchedRepos = (raw: string | undefined): string[] => {
  if (!raw) {
    return DEFAULT_WATCHED_REPOS;
  }

  const repos = raw
    .split(",")
    .map((repo) => repo.trim())
    .filter((repo) => repo.length > 0);

  return repos.length > 0 ? repos : DEFAULT_WATCHED_REPOS;
};

const parseGithubCredentialsByOwner = (
  watchedRepos: string[],
  environment: ProcessEnvironment,
): GitHubCredentialsByOwner => {
  const credentials: Record<string, string> = {};
  for (const repo of watchedRepos) {
    const owner = githubResourceOwner(repo);
    const credential = environment[githubCredentialEnvironmentVariable(owner)];
    if (credential && credential.trim().length > 0) {
      credentials[owner] = credential;
    }
  }
  return credentials;
};

export const env = (
  environment: ProcessEnvironment = process.env,
): ServerConfiguration => {
  const watchedRepos = parseWatchedRepos(environment.WATCHED_REPOS);

  return {
    nodeEnv: environment.NODE_ENV ?? "development",
    // Loopback by default so a deployment opts into any wider bind explicitly
    // (ADR 0001: the process binds a single private interface, never all of them).
    host: environment.HOST ?? "127.0.0.1",
    port: Number(environment.PORT ?? 3000),
    // Temporary compatibility credential for deployments that have not yet moved
    // every watched owner to its resource-owner credential.
    githubToken: environment.GITHUB_TOKEN,
    githubCredentialsByOwner: parseGithubCredentialsByOwner(
      watchedRepos,
      environment,
    ),
    watchedRepos,
    githubSource: environment.DOC_REVIEW_GITHUB_SOURCE ?? "github",
    reviewStatePath: environment.REVIEW_STATE_PATH ?? ".data/review-state.json",
  };
};
