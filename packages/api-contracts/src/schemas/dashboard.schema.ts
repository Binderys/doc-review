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

// One watched repo's live dashboard state. `repo` is the `owner/name` slug.
// Strict arms keep provider detail and mixed availability state out of the wire
// contract instead of silently stripping it during boundary parsing.
const availableRepoSchema = z
  .object({
    repo: z.string(),
    status: z.literal("available"),
    pullRequests: z.array(pullRequestListItemSchema),
  })
  .strict();

const unavailableRepoSchema = z
  .object({
    repo: z.string(),
    status: z.literal("unavailable"),
    reason: z.enum(["access", "rate-limited", "github-unavailable"]),
  })
  .strict();

export const dashboardRepoSchema = z.discriminatedUnion("status", [
  availableRepoSchema,
  unavailableRepoSchema,
]);

// Preserve the original available-group export as the available arm becomes
// one member of the dashboard union.
export const repoPullRequestsSchema = availableRepoSchema;

// Wire shape of `GET /dashboard`: every watched repo's open PRs, grouped by repo.
export const dashboardResponseSchema = z.object({
  repos: z.array(dashboardRepoSchema),
});

export type PullRequestListItem = z.infer<typeof pullRequestListItemSchema>;
export type DashboardRepo = z.infer<typeof dashboardRepoSchema>;
export type DashboardUnavailableReason = z.infer<
  typeof unavailableRepoSchema
>["reason"];
export type RepoPullRequests = z.infer<typeof repoPullRequestsSchema>;
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
