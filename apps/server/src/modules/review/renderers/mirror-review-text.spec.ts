import { normalizeMirrorReviewText } from "./mirror-review-text";

// #63: the normalized review-text must carry every block's visible text in document
// order, flattening inline markup, while keeping code and raw HTML literal. These pin
// the block types a naive top-level `text`/`tokens` walk would drop (lists, tables).
describe("normalizeMirrorReviewText", () => {
  it("keeps unordered list items, including nested ones, in order", () => {
    const text = normalizeMirrorReviewText(
      ["- First alpha", "- Second **bold** beta", "  - Nested gamma"].join(
        "\n",
      ),
    );
    expect(text).toBe("First alpha\nSecond bold beta\nNested gamma");
  });

  it("keeps ordered list items in order without the markers", () => {
    const text = normalizeMirrorReviewText(
      ["1. One delta", "2. Two epsilon"].join("\n"),
    );
    expect(text).toBe("One delta\nTwo epsilon");
    expect(text).not.toContain("1.");
  });

  it("keeps table header and body cells in reading order", () => {
    const text = normalizeMirrorReviewText(
      ["| Col A | Col B |", "| --- | --- |", "| cellone | cell **two** |"].join(
        "\n",
      ),
    );
    expect(text).toBe("Col A Col B\ncellone cell two");
  });

  it("keeps fenced code block content literal", () => {
    const text = normalizeMirrorReviewText(
      ["```", "code Zephyr line", "```"].join("\n"),
    );
    expect(text).toBe("code Zephyr line");
  });

  it("flattens a link to its visible text, dropping the URL", () => {
    const text = normalizeMirrorReviewText(
      "A [link text](https://example.com) tail.",
    );
    expect(text).toBe("A link text tail.");
    expect(text).not.toContain("https://example.com");
  });

  it("keeps blockquote content", () => {
    const text = normalizeMirrorReviewText(
      ["> Quoted Vorpal.", "> Second quoted."].join("\n"),
    );
    expect(text).toBe("Quoted Vorpal.\nSecond quoted.");
  });

  it("keeps a raw HTML block literal (sanitizing is downstream scope)", () => {
    const text = normalizeMirrorReviewText(
      '<div class="raw">Raw Grunion</div>',
    );
    expect(text).toBe('<div class="raw">Raw Grunion</div>');
  });

  it("emits every block in document order with blank-line boundaries", () => {
    const text = normalizeMirrorReviewText(
      [
        "# Heading H",
        "",
        "Para one.",
        "",
        "- item x",
        "- item y",
        "",
        "| A | B |",
        "| - | - |",
        "| p | q |",
      ].join("\n"),
    );
    expect(text).toBe("Heading H\n\nPara one.\n\nitem x\nitem y\n\nA B\np q");
  });
});
