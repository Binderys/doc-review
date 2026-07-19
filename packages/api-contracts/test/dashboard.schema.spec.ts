import {
  dashboardResponseSchema,
  pullRequestListItemSchema,
} from "../src/index";

const validItem = {
  number: 42,
  title: "Draft Q3 IC memo",
  branch: "agent/ic-memo-q3",
  author: "board-agent",
  createdAt: "2026-07-01T12:00:00.000Z",
};

describe("pullRequestListItemSchema", () => {
  it("accepts a valid PR list item", () => {
    expect(pullRequestListItemSchema.safeParse(validItem).success).toBe(true);
  });

  it("rejects an item missing branch", () => {
    const { branch: _branch, ...withoutBranch } = validItem;
    expect(pullRequestListItemSchema.safeParse(withoutBranch).success).toBe(
      false,
    );
  });

  it("rejects a non-integer number", () => {
    expect(
      pullRequestListItemSchema.safeParse({ ...validItem, number: 4.2 })
        .success,
    ).toBe(false);
  });

  it("rejects a non-ISO createdAt", () => {
    expect(
      pullRequestListItemSchema.safeParse({
        ...validItem,
        createdAt: "yesterday",
      }).success,
    ).toBe(false);
  });
});

describe("dashboardResponseSchema", () => {
  it.each([
    {
      repo: "acme/board-review",
      status: "available",
      pullRequests: [validItem],
    },
    {
      repo: "acme/private-review",
      status: "unavailable",
      reason: "access",
    },
    {
      repo: "acme/rate-limited-review",
      status: "unavailable",
      reason: "rate-limited",
    },
    {
      repo: "acme/intermittent-review",
      status: "unavailable",
      reason: "github-unavailable",
    },
  ])("accepts the valid $status/$reason arm", (repo) => {
    expect(dashboardResponseSchema.safeParse({ repos: [repo] }).success).toBe(
      true,
    );
  });

  it("rejects a group whose PRs are not an array", () => {
    expect(
      dashboardResponseSchema.safeParse({
        repos: [
          {
            repo: "acme/board-review",
            status: "available",
            pullRequests: validItem,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it.each([
    {
      repo: "acme/board-review",
      status: "available",
      pullRequests: [validItem],
      reason: "access",
    },
    {
      repo: "acme/private-review",
      status: "unavailable",
      reason: "access",
      pullRequests: [],
    },
  ])("rejects mixed available and unavailable state", (repo) => {
    expect(dashboardResponseSchema.safeParse({ repos: [repo] }).success).toBe(
      false,
    );
  });

  it.each([
    {
      repo: "acme/board-review",
      status: "available",
      pullRequests: [],
      requestId: "provider-request-123",
    },
    {
      repo: "acme/private-review",
      status: "unavailable",
      reason: "access",
      providerMessage: "Bad credentials",
    },
  ])("rejects provider-specific extra state", (repo) => {
    expect(dashboardResponseSchema.safeParse({ repos: [repo] }).success).toBe(
      false,
    );
  });
});
