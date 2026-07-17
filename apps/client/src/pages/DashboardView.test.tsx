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
      repo: "acme/market-research",
      pullRequests: [
        {
          number: 7,
          title: "Add competitor teardown",
          branch: "agent/competitor-teardown",
          author: "research-agent",
          createdAt: "2026-06-15T09:30:00.000Z",
        },
      ],
    },
  ],
};

describe("DashboardView", () => {
  it("renders the grouped PR list with per-PR fields and a review-surface link", () => {
    const html = renderToStaticMarkup(<DashboardView {...fixture} />);

    // Repo groups.
    expect(html).toContain("acme/board-review");
    expect(html).toContain("acme/market-research");

    // Per-PR fields.
    expect(html).toContain("#42");
    expect(html).toContain("Draft Q3 IC memo");
    expect(html).toContain("agent/ic-memo-q3");
    expect(html).toContain("board-agent");

    // A displayed age derived from createdAt.
    expect(html).toContain("ago");

    // A link to each review surface (/pr/:owner/:repo/:number).
    expect(html).toContain('href="/pr/acme/board-review/42"');
    expect(html).toContain('href="/pr/acme/market-research/7"');
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
