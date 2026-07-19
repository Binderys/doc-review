import type {
  DashboardResponse,
  DashboardUnavailableReason,
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

// Presentational: renders grouped PR data from props. No fetching, so it renders
// deterministically for the client smoke test.
export function DashboardView({ repos }: DashboardResponse) {
  return (
    <div className="dashboard">
      {repos.map((group) => (
        <section
          className="dashboard__repo"
          key={group.repo}
          aria-labelledby={`repo-${group.repo}`}
          aria-describedby={`repo-status-${group.repo}`}
        >
          <h2 id={`repo-${group.repo}`}>{group.repo}</h2>
          {group.status === "unavailable" ? (
            <p
              className="dashboard__status dashboard__status--unavailable"
              id={`repo-status-${group.repo}`}
            >
              {unavailableStatusText[group.reason]}
            </p>
          ) : (
            <>
              <p
                className="dashboard__status dashboard__status--available"
                id={`repo-status-${group.repo}`}
              >
                Available
              </p>
              {group.pullRequests.length === 0 ? (
                <p className="dashboard__empty">No open pull requests.</p>
              ) : (
                <ul className="dashboard__prs">
                  {group.pullRequests.map((pull) => (
                    <li className="dashboard__pr" key={pull.number}>
                      <a href={reviewHref(group.repo, pull.number)}>
                        <span className="dashboard__pr-number">
                          #{pull.number}
                        </span>
                        <span className="dashboard__pr-title">
                          {pull.title}
                        </span>
                      </a>
                      <span className="dashboard__pr-branch">
                        {pull.branch}
                      </span>
                      <span className="dashboard__pr-author">
                        {pull.author}
                      </span>
                      <span className="dashboard__pr-age">
                        {formatAge(pull.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      ))}
    </div>
  );
}
