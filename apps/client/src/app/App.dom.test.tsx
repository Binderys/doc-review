// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadRenderedAnnotator } from "../features/annotation/loadRenderedAnnotator";
import { App } from "./App";

// A failing annotation-loader spy (#70 criterion 7): the app's initial (home/dashboard)
// render must never reach the rendered-annotation loader, so any invocation throws. This
// file runs under happy-dom so App travels the browser branch of currentPath() and its
// effects run; the SSR fallback branch stays covered by the node-environment App.test.tsx.
vi.mock("../features/annotation/loadRenderedAnnotator", () => ({
  loadRenderedAnnotator: vi.fn(() => {
    throw new Error(
      "the initial app render must not load the annotation adapter",
    );
  }),
}));

// Settle the home page's dashboard fetch deterministically without touching the network -
// the default `apiClient` captured the global fetch at module load, so a fetch spy would
// not intercept it. Only `dashboardApi` is stubbed; the rest of the API stays real.
vi.mock("../shared/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../shared/api")>();
  return {
    ...actual,
    dashboardApi: { getDashboard: vi.fn().mockResolvedValue({ repos: [] }) },
  };
});

const loadSpy = vi.mocked(loadRenderedAnnotator);

describe("App mounted home render", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not reach the annotation loader on its initial home render", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    // The dashboard shell renders and no annotation surface is mounted; the failing loader
    // spy was never called across the initial render and its effects.
    expect(container.textContent).toContain("Open pull requests");
    expect(container.querySelector("[data-annotation-surface]")).toBeNull();
    expect(loadSpy).not.toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
  });
});
