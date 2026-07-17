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
  it("accepts repos grouped with their open PRs", () => {
    const result = dashboardResponseSchema.safeParse({
      repos: [{ repo: "acme/board-review", pullRequests: [validItem] }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a group whose PRs are not an array", () => {
    expect(
      dashboardResponseSchema.safeParse({
        repos: [{ repo: "acme/board-review", pullRequests: validItem }],
      }).success,
    ).toBe(false);
  });
});
