import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "./App";

// Node environment (no DOM) ON PURPOSE: with `window` undefined, App's currentPath()
// takes its SSR fallback to "/" and renders the home shell. A DOM environment would make
// `window` exist and travel the browser branch instead, so keep this SSR path covered
// here; the mounted browser-branch behavior lives in App.dom.test.tsx.
describe("App", () => {
  it("renders the home page shell", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain("doc-review");
    expect(html).toContain("Open pull requests");
  });
});
