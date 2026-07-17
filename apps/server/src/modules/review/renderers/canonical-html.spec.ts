import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildEmbeddedStyleMapDocx,
  buildRichCanonicalDocx,
} from "../../../../test/fixtures/minimal-docx";
import { convertCanonicalHtml } from "./canonical-html";

// The single physical source of truth for the rendered Canonical head (#67, item 3): the
// server pins the REAL mammoth output against these fixture files, and the client's
// mounted-DOM test loads the SAME files, so the two-sided criterion-1 pair rests on one
// artifact. A mammoth upgrade that changes the emitted HTML breaks the pin here and forces a
// deliberate fixture refresh, rather than letting a hand-copied client constant silently
// drift from real output.
function readFixture(name: string): {
  renderedHead: string;
  reviewText: string;
} {
  return JSON.parse(
    readFileSync(join(__dirname, "../../../../test/fixtures", name), "utf8"),
  ) as { renderedHead: string; reviewText: string };
}

const normalizeWhitespace = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

describe("convertCanonicalHtml (single owner of Canonical HTML production)", () => {
  it("reproduces the rendered head and review-text pinned in the criterion-1 fixture", async () => {
    const fixture = readFixture("canonical-rendered-head.json");
    const { html, reviewText } = await convertCanonicalHtml(
      buildRichCanonicalDocx(),
    );

    // Real mammoth output equals the fixture the client mounts, byte for byte.
    expect(html).toBe(fixture.renderedHead);
    // And the review-text the validation seam reproduces equals the fixture's, with the
    // discriminating structure (heading and paragraph joined, split run contiguous, table
    // cells joined, no raw markup).
    expect(reviewText).toBe(fixture.reviewText);
    expect(reviewText).not.toContain("<");
    expect(normalizeWhitespace(reviewText)).not.toContain(
      "overview.The Bandersnatch",
    );
    expect(reviewText).toContain("Second paragraph about canonical scope.");
  });

  it("ignores a document-embedded style map so the emitted tag set stays within the default set (item 2)", async () => {
    const fixture = readFixture("canonical-embedded-style-map-head.json");
    const { html, reviewText } = await convertCanonicalHtml(
      await buildEmbeddedStyleMapDocx(),
    );

    // Real mammoth output equals the fixture the client mounts.
    expect(html).toBe(fixture.renderedHead);

    // The embedded style map tried to steer an inline run to a `<fieldset>` (an off-allowlist
    // block tag), but `includeEmbeddedStyleMap: false` made mammoth ignore it: the emitted
    // HTML carries only default-set tags, so no off-allowlist tag ever reaches the trusted,
    // UN-sanitized Canonical DOM, and the two block-aware engines cannot diverge on it.
    for (const offDefault of ["<fieldset", "<details", "<form"]) {
      expect(html).not.toContain(offDefault);
    }

    // The mapped run's text survives (only its steered element was dropped), contiguous with
    // its surrounding inline text - exactly what the client extraction produces for this DOM.
    expect(reviewText).toBe(fixture.reviewText);
    expect(reviewText).toContain(
      "Alpha inline sentinel Beta boxed sentinel Gamma inline sentinel.",
    );
  });
});
