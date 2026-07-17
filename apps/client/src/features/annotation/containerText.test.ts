// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import {
  extractBlockText,
  locateQuoteInContainer,
  readContainerContext,
} from "./containerText";
import { findQuoteSpan } from "./renderedTextSelector";

function render(html: string): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container;
}

describe("extractBlockText", () => {
  it("inserts a separator at block boundaries so adjacent block words never merge", () => {
    const container = render("<p>review</p><p>carefully</p>");
    // Raw textContent merges the two words - the exact defect.
    expect(container.textContent).toBe("reviewcarefully");
    // Block-aware extraction keeps them separated by whitespace.
    const { text } = extractBlockText(container);
    expect(text).toContain("review");
    expect(text).toContain("carefully");
    expect(text).not.toContain("reviewcarefully");
    // So the phantom merged word is not findable block-aware, though it is in raw text.
    expect(findQuoteSpan(text, { quote: "reviewcarefully" })).toBeNull();
    expect(
      findQuoteSpan(container.textContent ?? "", { quote: "reviewcarefully" }),
    ).not.toBeNull();
  });
});

describe("locateQuoteInContainer", () => {
  it("maps a located quote back to raw textContent offsets for the renderer", () => {
    const container = render(
      "<p>The intro block here.</p><p>The target phrase sits in block two.</p>",
    );
    const text = container.textContent ?? "";
    const start = text.indexOf("target phrase");
    // The painting path requires context even for a unique match; a stored comment
    // always carries it.
    expect(
      locateQuoteInContainer(container, {
        quote: "target phrase",
        prefix: "The ",
        suffix: " sits in block two.",
      }),
    ).toEqual({ start, end: start + "target phrase".length });
  });

  it("reconciles a hard break inside the context window (server emits a separator for <br>)", () => {
    // The server emits "\n" for a `br`; a repeated quote's legitimate occurrence has a
    // hard break inside its context window. Break-blind extraction merges the words
    // around it ("one" + "second" -> "onesecond") and mis-locates; the break-aware walk
    // reconciles it.
    const reviewText =
      "Opening line one\nsecond line then the widget appears clearly here.\n\nMuch later on the widget appears again in another place entirely.";
    const legitStart = reviewText.indexOf("the widget");
    const highlight = {
      id: "legit",
      quote: "the widget",
      prefix: reviewText.slice(Math.max(0, legitStart - 32), legitStart),
      suffix: reviewText.slice(
        legitStart + "the widget".length,
        legitStart + "the widget".length + 32,
      ),
    };

    const container = render(
      "<p>Opening line one<br>second line then the widget appears clearly here.</p>" +
        "<p>Much later on the widget appears again in another place entirely.</p>",
    );
    const legitContentStart = (container.textContent ?? "").indexOf(
      "the widget",
    );

    expect(locateQuoteInContainer(container, highlight)).toEqual({
      start: legitContentStart,
      end: legitContentStart + "the widget".length,
    });
    // Break-blind (raw textContent) fails closed here - proving the <br> handling matters.
    expect(findQuoteSpan(container.textContent ?? "", highlight)).toBeNull();
  });

  it("reconciles an image alt inside the context window (server flattens <img> to its alt)", () => {
    // The server's marked flatten includes an image's alt text; the DOM's textContent
    // does not. A repeated quote's legitimate occurrence has an image in its context
    // window; alt-blind extraction drops those words and mis-locates.
    const reviewText =
      "See the chart clearly then the widget appears here plainly.\n\nMuch later the widget appears again elsewhere entirely now.";
    const legitStart = reviewText.indexOf("the widget");
    const highlight = {
      id: "legit",
      quote: "the widget",
      prefix: reviewText.slice(Math.max(0, legitStart - 32), legitStart),
      suffix: reviewText.slice(
        legitStart + "the widget".length,
        legitStart + "the widget".length + 32,
      ),
    };

    const container = render(
      '<p>See <img alt="the chart"> clearly then the widget appears here plainly.</p>' +
        "<p>Much later the widget appears again elsewhere entirely now.</p>",
    );
    const legitContentStart = (container.textContent ?? "").indexOf(
      "the widget",
    );

    expect(locateQuoteInContainer(container, highlight)).toEqual({
      start: legitContentStart,
      end: legitContentStart + "the widget".length,
    });
    // Alt-blind (raw textContent) fails closed here - proving the <img> alt handling matters.
    expect(findQuoteSpan(container.textContent ?? "", highlight)).toBeNull();
  });

  it("reconciles a block-join inside the context window that raw textContent would break", () => {
    // The review-text joins blocks with whitespace; a repeated quote's legitimate
    // occurrence has that join inside its 32-char context window, while a near-duplicate
    // elsewhere keeps intact context. Under raw textContent the join is a word-merge that
    // breaks the legitimate occurrence's context; block-aware extraction reconciles it.
    const reviewText =
      "First the budget rises across the quarter and the year ends strongly here now.\n\nLater the budget rises again in the second review of the whole plan overall.";
    const legitStart = reviewText.indexOf(
      "the budget rises",
      reviewText.indexOf("the budget rises") + 1,
    );
    const highlight = {
      id: "legit",
      quote: "the budget rises",
      prefix: reviewText.slice(Math.max(0, legitStart - 32), legitStart),
      suffix: reviewText.slice(
        legitStart + "the budget rises".length,
        legitStart + "the budget rises".length + 32,
      ),
    };

    const container = render(
      "<p>First the budget rises across the quarter and the year ends strongly here now.</p>" +
        "<p>Later the budget rises again in the second review of the whole plan overall.</p>",
    );
    const legitContentStart = (container.textContent ?? "").indexOf(
      "the budget rises",
      (container.textContent ?? "").indexOf("the budget rises") + 1,
    );

    // Block-aware extraction locates the legitimate occurrence correctly.
    expect(locateQuoteInContainer(container, highlight)).toEqual({
      start: legitContentStart,
      end: legitContentStart + "the budget rises".length,
    });
    // Raw textContent fails closed here (the merge broke the legitimate context, and no
    // occurrence matches) - proving the block-aware extraction is load-bearing.
    expect(findQuoteSpan(container.textContent ?? "", highlight)).toBeNull();
  });

  it("paints nothing for a repeated quote whose stored context matches no occurrence", () => {
    // A genuine divergence with no reconciliation: the quote repeats, but the stored
    // context describes surroundings neither occurrence has - it must paint the wrong
    // duplicate NEVER, so it paints nothing.
    const container = render(
      "<p>First the plan proceeds here.</p><p>Later the plan concludes there.</p>",
    );
    expect(
      locateQuoteInContainer(container, {
        quote: "the plan",
        prefix: "some entirely different preceding ",
        suffix: " and different following words here",
      }),
    ).toBeNull();
  });

  it("refuses a quote that lies in fabricated (image alt) text with no DOM home", () => {
    const container = render(
      '<p>See <img alt="the chart"> now clearly here.</p>',
    );
    // The quote is entirely the image alt: it has no DOM range and must not paint.
    expect(
      locateQuoteInContainer(container, {
        quote: "the chart",
        prefix: "See ",
        suffix: " now clearly here.",
      }),
    ).toBeNull();
  });

  it("refuses a quote that ends inside image alt text", () => {
    const container = render(
      '<p>Prefix words then See <img alt="the chart"> tail here.</p>',
    );
    // The quote runs from real text into the alt; its span overlaps fabricated text.
    expect(
      locateQuoteInContainer(container, {
        quote: "See the chart",
        prefix: "Prefix words then ",
        suffix: " tail here.",
      }),
    ).toBeNull();
  });

  it("refuses a quote touching a terminal image (no out-of-range span)", () => {
    const container = render(
      '<p>The report finally ends right here <img alt="signature"></p>',
    );
    // A terminal image: a quote reaching into its alt must fail closed, never produce an
    // end past the raw textContent length.
    expect(
      locateQuoteInContainer(container, {
        quote: "here signature",
        prefix: "The report finally ends right ",
        suffix: "",
      }),
    ).toBeNull();
  });

  it("refuses a quote that spans across image alt text (real -> fabricated -> real)", () => {
    // Real text sits on BOTH sides of the image and the quote crosses the alt in its
    // interior; the interior fabricated scan must refuse it, not just the endpoints.
    const container = render(
      '<p>before <img alt="middle"> after words here.</p>',
    );
    expect(
      locateQuoteInContainer(container, {
        quote: "before middle after",
        prefix: "",
        suffix: " words here.",
      }),
    ).toBeNull();
  });

  it("still paints a quote whose CONTEXT (not quote) includes image alt text", () => {
    // The regression that justifies emitting alt at all: alt in the context window must
    // let a real quote locate; only the quote span itself may not overlap fabricated text.
    const container = render(
      '<p>See <img alt="the chart"> then note this point here.</p>',
    );
    const text = container.textContent ?? "";
    const start = text.indexOf("note this");
    expect(
      locateQuoteInContainer(container, {
        quote: "note this",
        prefix: "the chart then ",
        suffix: " point here.",
      }),
    ).toEqual({ start, end: start + "note this".length });
  });

  it("keeps offsets exact across an astral character in image alt text (code units)", () => {
    // An emoji in the alt is a surrogate pair (two code units). Iterating code points
    // would desync every later offset; a quote after the image must still map exactly.
    const container = render(
      '<p>Intro <img alt="a 📊 b"> then the target sits here now.</p>',
    );
    const text = container.textContent ?? "";
    const start = text.indexOf("the target");
    expect(
      locateQuoteInContainer(container, {
        quote: "the target",
        prefix: "a 📊 b then ",
        suffix: " sits here now.",
      }),
    ).toEqual({ start, end: start + "the target".length });
  });
});

describe("readContainerContext", () => {
  it("reports block-aware context so a boundary-adjacent selection is not merged", () => {
    const container = render(
      "<p>The first block ends with review</p><p>carefully begins the next block cleanly.</p>",
    );
    const text = container.textContent ?? "";
    const start = text.indexOf("review");
    const { suffix } = readContainerContext(
      container,
      start,
      start + "review".length,
    );
    // The suffix crosses the block boundary; it must carry the separator, not "reviewcarefully".
    expect(suffix.startsWith(" ") || suffix.startsWith("\n")).toBe(true);
    expect(suffix).not.toContain("reviewcarefully");
    expect(suffix).toContain("carefully");
  });
});
