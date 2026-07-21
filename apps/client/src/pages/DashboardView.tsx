import type {
  DashboardRepo,
  DashboardResponse,
  DashboardUnavailableReason,
  PullRequestListItem,
} from "@doc-review/api-contracts";

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

const unavailableStatusText: Record<DashboardUnavailableReason, string> = {
  access: "Access unavailable",
  "rate-limited": "Rate limited",
  "github-unavailable": "GitHub unavailable",
};

const unavailableGlyph = "◇"; // ◇ open diamond: read did not complete
const availableGlyph = "◆"; // ◆ filled diamond: read is current

// Derives a human-readable age from an ISO 8601 timestamp. Age is computed at
// display time (not shipped by the server) so the contract stays deterministic.
export function formatAge(createdAt: string, now: Date = new Date()): string {
  const elapsed = Math.max(
    0,
    Math.floor((now.getTime() - new Date(createdAt).getTime()) / 1000),
  );

  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed < MONTH) return `${Math.floor(elapsed / DAY)}d ago`;
  if (elapsed < YEAR) return `${Math.floor(elapsed / MONTH)}mo ago`;
  return `${Math.floor(elapsed / YEAR)}y ago`;
}

// The review surface lives at /pr/:owner/:repo/:number (issue #7's page). `repo`
// is the `owner/name` slug from the contract.
function reviewHref(repo: string, prNumber: number): string {
  return `/pr/${repo}/${prNumber}`;
}

// The `owner/name` slug's two parts. The studio journey groups watched repos under
// their GitHub resource owner, so the owner leads the grouping and the name titles
// the repo. A slug without a slash degrades to an empty owner and the whole slug.
function splitSlug(repo: string): { owner: string; name: string } {
  const slash = repo.indexOf("/");
  if (slash < 0) return { owner: "", name: repo };
  return { owner: repo.slice(0, slash), name: repo.slice(slash + 1) };
}

// Groups the flat wire list by GitHub resource owner, preserving each owner's and
// each repo's first-seen order so the dashboard renders deterministically.
function groupByOwner(
  repos: DashboardRepo[],
): { owner: string; repos: DashboardRepo[] }[] {
  const groups: { owner: string; repos: DashboardRepo[] }[] = [];
  const index = new Map<string, number>();
  for (const repo of repos) {
    const { owner } = splitSlug(repo.repo);
    const at = index.get(owner);
    if (at === undefined) {
      index.set(owner, groups.length);
      groups.push({ owner, repos: [repo] });
    } else {
      groups[at].repos.push(repo);
    }
  }
  return groups;
}

function RepoStatus({ group }: { group: DashboardRepo }) {
  if (group.status === "unavailable") {
    return (
      <p
        className="dashboard__status dashboard__status--unavailable"
        id={`repo-status-${group.repo}`}
      >
        <span aria-hidden="true">{unavailableGlyph}</span>{" "}
        {unavailableStatusText[group.reason]}
      </p>
    );
  }
  return (
    <p
      className="dashboard__status dashboard__status--available"
      id={`repo-status-${group.repo}`}
    >
      <span aria-hidden="true">{availableGlyph}</span> Available
    </p>
  );
}

function PrCard({ repo, pull }: { repo: string; pull: PullRequestListItem }) {
  return (
    <li className="dashboard__pr">
      <a href={reviewHref(repo, pull.number)}>
        <span className="dashboard__pr-number">#{pull.number}</span>
        <span className="dashboard__pr-title">{pull.title}</span>
        <span className="dashboard__pr-meta">
          <span className="dashboard__pr-branch">{pull.branch}</span>
          <span className="dashboard__pr-dot" aria-hidden="true">
            &middot;
          </span>
          <span className="dashboard__pr-author">{pull.author}</span>
          <span className="dashboard__pr-age">{formatAge(pull.createdAt)}</span>
        </span>
      </a>
    </li>
  );
}

function RepoSection({ group }: { group: DashboardRepo }) {
  const { name } = splitSlug(group.repo);
  return (
    <section
      className="dashboard__repo"
      aria-labelledby={`repo-${group.repo}`}
      aria-describedby={`repo-status-${group.repo}`}
    >
      <div className="dashboard__repo-head">
        <h3 id={`repo-${group.repo}`} className="dashboard__repo-name">
          {name}
        </h3>
        <RepoStatus group={group} />
      </div>
      {group.status === "unavailable" ? (
        <p className="dashboard__unavailable">
          This watched repo could not be read right now. Available repos are
          unaffected; it stays listed and retries on its own until the read
          recovers.
        </p>
      ) : group.pullRequests.length === 0 ? (
        <p className="dashboard__empty">No open pull requests.</p>
      ) : (
        <ul className="dashboard__prs">
          {group.pullRequests.map((pull) => (
            <PrCard key={pull.number} repo={group.repo} pull={pull} />
          ))}
        </ul>
      )}
    </section>
  );
}

// Presentational: renders grouped PR data from props. No fetching, so it renders
// deterministically for the client smoke test. Watched repos are grouped under their
// GitHub resource owner (the studio journey); each repo keeps its own availability
// state and links, and unavailable repos never block the available ones.
export function DashboardView({ repos }: DashboardResponse) {
  const owners = groupByOwner(repos);
  const openCount = repos.reduce(
    (sum, group) =>
      sum + (group.status === "available" ? group.pullRequests.length : 0),
    0,
  );

  return (
    <div className="dashboard">
      <p className="dashboard__count">
        <span className="dashboard__count-n">{openCount}</span> open for review
        across <span className="dashboard__count-n">{repos.length}</span>{" "}
        watched {repos.length === 1 ? "repo" : "repos"}
      </p>
      {owners.map((ownerGroup) => (
        <section className="dashboard__owner" key={ownerGroup.owner}>
          <h2 className="dashboard__owner-name">{ownerGroup.owner}</h2>
          {ownerGroup.repos.map((group) => (
            <RepoSection key={group.repo} group={group} />
          ))}
        </section>
      ))}
    </div>
  );
}
