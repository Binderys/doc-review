import { normalizeHtmlReviewText } from "./html-review-text";

// #66: the normalized HTML review-text must carry the visible safe text in document
// order, applying the same allowlist and block semantics as the client's DOMPurify copy
// (`sanitizeHtml.ts`) plus block-aware extraction (`containerText.ts`). These pin the
// decisions a naive raw-markup strip would get wrong: dropped script/style bodies,
// unwrapped structural tags, block joins, whitespace, and image alt text.
describe("normalizeHtmlReviewText", () => {
  it("joins adjacent blocks with a boundary instead of merging their text", () => {
    expect(
      normalizeHtmlReviewText("<p>Alpha point.</p><p>Beta point.</p>"),
    ).toBe("Alpha point.\nBeta point.");
  });

  it("drops a script subtree entirely, body and all", () => {
    expect(
      normalizeHtmlReviewText(
        "<p>Kept text.</p><script>window.__x = 'SCRIPTBODY';</script>",
      ),
    ).toBe("Kept text.");
  });

  it("drops a style subtree entirely, body and all", () => {
    expect(
      normalizeHtmlReviewText(
        "<style>.secret{content:'STYLEBODY'}</style><p>Kept.</p>",
      ),
    ).toBe("Kept.");
  });

  it("drops head content but keeps the body copy", () => {
    expect(
      normalizeHtmlReviewText(
        "<head><title>Title text</title></head><body><p>Body text.</p></body>",
      ),
    ).toBe("Body text.");
  });

  it("unwraps a disallowed structural tag, keeping its inner text in order", () => {
    expect(
      normalizeHtmlReviewText(
        "<details><summary>Summary control.</summary><p>Disclosure body.</p></details>",
      ),
    ).toBe("Summary control.\nDisclosure body.");
  });

  it("flattens an image to its alt text and drops its src", () => {
    expect(
      normalizeHtmlReviewText(
        '<p>Before.</p><img src="https://tracker.example/pixel.png" alt="Pixel caption."><p>After.</p>',
      ),
    ).toBe("Before.\nPixel caption.\nAfter.");
  });

  it("keeps inline markup as its text and drops link and style attributes", () => {
    expect(
      normalizeHtmlReviewText(
        '<p>A <a href="https://x.example">link label</a> and <strong>bold</strong> tail.</p>',
      ),
    ).toBe("A link label and bold tail.");
  });

  it("emits a boundary for a hard break", () => {
    expect(normalizeHtmlReviewText("<p>First line.<br>Second line.</p>")).toBe(
      "First line.\nSecond line.",
    );
  });

  it("decodes common and numeric entities in visible text", () => {
    expect(
      normalizeHtmlReviewText("<p>Ampersand &amp; less &lt; hash &#65;.</p>"),
    ).toBe("Ampersand & less < hash A.");
  });

  it("does not collapse a hyphenated custom element into the tag it prefixes (script-x is not script)", () => {
    // A custom element must keep its own text - the browser DOM unwraps it - and never be
    // swallowed by the script drop-subtree branch (which would drop "Pick me" and leave
    // the server text with one occurrence where the DOM has two: the #66 wrong-text
    // hazard). img-x is likewise not an <img> alt flatten.
    expect(
      normalizeHtmlReviewText(
        "<script-x>Pick me</script-x></script><p>other</p><p>Pick me</p>",
      ),
    ).toBe("Pick me\nother\nPick me");
    expect(normalizeHtmlReviewText('<p><img-x alt="phantom">kept</p>')).toBe(
      "kept",
    );
  });

  it("does not truncate a tag at a quoted-attribute angle bracket", () => {
    // A `>` inside a quoted attribute value must not end the tag: the tag is consumed
    // whole (alt flattened, no markup tail leaked into the review-text).
    expect(
      normalizeHtmlReviewText('<p>Before.<img alt="A > B">After.</p>'),
    ).toBe("Before.A > BAfter.");
    // The `>` inside the alt is not read as the tag end, so no `">After."` tail leaks.
    expect(
      normalizeHtmlReviewText('<p>Before.<img alt="A > B">After.</p>'),
    ).not.toContain('"');
  });
});
