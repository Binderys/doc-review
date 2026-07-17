import { z } from "zod";

// Wire shape of one open PR as it appears in the dashboard list
// (apps/server/src/modules/dashboard). `createdAt` ships as an ISO 8601 string;
// the client derives a human-readable age at display time, so the contract stays
// deterministic and free of clock-dependent values.
export const pullRequestListItemSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  branch: z.string(),
  author: z.string(),
  createdAt: z.string().datetime(),
});

// One watched repo and its open PRs. `repo` is the `owner/name` slug.
export const repoPullRequestsSchema = z.object({
  repo: z.string(),
  pullRequests: z.array(pullRequestListItemSchema),
});

// Wire shape of `GET /dashboard`: every watched repo's open PRs, grouped by repo.
export const dashboardResponseSchema = z.object({
  repos: z.array(repoPullRequestsSchema),
});

export type PullRequestListItem = z.infer<typeof pullRequestListItemSchema>;
export type RepoPullRequests = z.infer<typeof repoPullRequestsSchema>;
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
