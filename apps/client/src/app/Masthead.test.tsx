// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { Masthead } from "./Masthead";

describe("Masthead", () => {
  it("carries the binderys lockup, the folio sibling, and an optional crumb", () => {
    const html = renderToStaticMarkup(<Masthead crumb="#42" />);

    expect(html).toContain('href="/"');
    expect(html).toContain("binderys");
    expect(html).toContain("folio 01");
    expect(html).toContain("Doc Review");
    expect(html).toContain("#42");
    // The Paper/Ink control offers both grounds.
    expect(html).toContain("Paper");
    expect(html).toContain("Ink");
  });

  it("omits the crumb when none is given", () => {
    const html = renderToStaticMarkup(<Masthead />);
    expect(html).not.toContain("masthead__crumb");
  });
});

describe("Masthead ground control", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
  });

  it("reflects the chosen ground onto the document root and the pressed control", () => {
    const container = document.createElement("div");
    document.body.append(container);
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const root = createRoot(container);

    act(() => root.render(<Masthead />));

    // Opens on the default ink ground and applies it to the root before interaction.
    expect(document.documentElement.getAttribute("data-theme")).toBe("ink");

    const paper = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Paper",
    );
    expect(paper).toBeDefined();

    act(() => paper?.click());

    expect(document.documentElement.getAttribute("data-theme")).toBe("paper");
    expect(paper?.getAttribute("aria-pressed")).toBe("true");

    act(() => root.unmount());
    container.remove();
  });
});
