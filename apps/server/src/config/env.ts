// Launch default: the only watched repo until a fork adds more. Overridden by a
// comma-separated WATCHED_REPOS env value.
const DEFAULT_WATCHED_REPOS = ["acme/board-review"];

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

export const env = () => ({
  nodeEnv: process.env.NODE_ENV ?? "development",
  // Loopback by default so a deployment opts into any wider bind explicitly
  // (ADR 0001: the process binds a single private interface, never all of them).
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 3000),
  // Read-scope GitHub credential the GitHub source authenticates with. Development
  // may omit it; production validation requires it explicitly.
  githubToken: process.env.GITHUB_TOKEN,
  watchedRepos: parseWatchedRepos(process.env.WATCHED_REPOS),
  githubSource: process.env.DOC_REVIEW_GITHUB_SOURCE ?? "github",
  reviewStatePath: process.env.REVIEW_STATE_PATH ?? ".data/review-state.json",
});
