// @vitest-environment happy-dom

import type { DashboardResponse } from "@doc-review/api-contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { loadRenderedAnnotator } from "../features/annotation/loadRenderedAnnotator";
import { DashboardView, formatAge } from "./DashboardView";

// A failing annotation-loader spy (#70 criterion 7): dashboard rendering must never reach
// the rendered-annotation loader, so any invocation throws and fails the test.
vi.mock("../features/annotation/loadRenderedAnnotator", () => ({
  loadRenderedAnnotator: vi.fn(() => {
    throw new Error("dashboard rendering must not load the annotation adapter");
  }),
}));

const loadSpy = vi.mocked(loadRenderedAnnotator);

const fixture: DashboardResponse = {
  repos: [
    {
      repo: "acme/board-review",
      status: "available",
      pullRequests: [
        {
          number: 42,
          title: "Draft Q3 IC memo",
          branch: "agent/ic-memo-q3",
          author: "board-agent",
          createdAt: "2026-07-01T12:00:00.000Z",
        },
      ],
    },
    {
      repo: "acme/empty-review",
      status: "available",
      pullRequests: [],
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
      repo: "acme/offline-review",
      status: "unavailable",
      reason: "github-unavailable",
    },
  ],
};

describe("DashboardView", () => {
  it("renders every availability state in order with semantic status text and safe links", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<DashboardView {...fixture} />);

    const headings = Array.from(container.querySelectorAll("h2"));
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "acme/board-review",
      "acme/empty-review",
      "acme/private-review",
      "acme/rate-limited-review",
      "acme/offline-review",
    ]);

    const groupFor = (repo: string): HTMLElement => {
      const heading = headings.find((item) => item.textContent === repo);
      const group = heading?.closest("section");
      expect(group).not.toBeNull();
      return group as HTMLElement;
    };

    const healthy = groupFor("acme/board-review");
    expect(healthy.textContent).toContain("Available");
    expect(healthy.textContent).toContain("#42");
    expect(healthy.textContent).toContain("Draft Q3 IC memo");
    expect(healthy.textContent).toContain("agent/ic-memo-q3");
    expect(healthy.textContent).toContain("board-agent");
    expect(healthy.textContent).toContain("ago");
    expect(
      healthy.querySelector('a[href="/pr/acme/board-review/42"]'),
    ).not.toBeNull();

    const empty = groupFor("acme/empty-review");
    expect(empty.textContent).toContain("Available");
    expect(empty.textContent).toContain("No open pull requests.");

    const unavailableGroups = [
      ["acme/private-review", "Access unavailable"],
      ["acme/rate-limited-review", "Rate limited"],
      ["acme/offline-review", "GitHub unavailable"],
    ] as const;
    for (const [repo, statusText] of unavailableGroups) {
      const group = groupFor(repo);
      expect(group.textContent).toContain(statusText);
      expect(group.querySelector("a")).toBeNull();
      expect(group.querySelector("ul")).toBeNull();
    }

    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent?.toLowerCase()).not.toContain("retry");
  });

  it("mounts no annotation surface and never instantiates the annotation adapter", () => {
    const container = document.createElement("div");
    document.body.append(container);
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const root = createRoot(container);

    act(() => root.render(<DashboardView {...fixture} />));

    // The dashboard renders its grouped PR list but no rendered-annotation surface, and
    // the failing loader spy was never called.
    expect(container.querySelector(".dashboard__pr")).not.toBeNull();
    expect(container.querySelector("[data-annotation-surface]")).toBeNull();
    expect(loadSpy).not.toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
  });
});

describe("formatAge", () => {
  it("derives a stable age from createdAt against a fixed clock", () => {
    const now = new Date("2026-07-01T15:00:00.000Z");
    expect(formatAge("2026-07-01T12:00:00.000Z", now)).toBe("3h ago");
    expect(formatAge("2026-07-01T14:59:30.000Z", now)).toBe("just now");
    expect(formatAge("2026-06-01T12:00:00.000Z", now)).toBe("1mo ago");
  });
});
