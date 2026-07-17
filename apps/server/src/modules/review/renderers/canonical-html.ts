import mammoth from "mammoth";
import { normalizeHtmlReviewText } from "./html-review-text";

// The rendered Canonical's HTML and its authoritative normalized review-text, produced
// together from one mammoth conversion so they can never describe different heads.
export type CanonicalHtml = { html: string; reviewText: string };

// The single owner of Canonical (.docx) HTML production (#67). Both the docx renderer (the
// HTML the client mounts, on the payload) and the review service's rendered-text validation
// seam (`reproduceRenderedReviewText`) call THIS, so the mounted HTML and the review-text the
// server reproduces to validate a selector are the SAME mammoth call flattened by the SAME
// tokenizer, in one place - a future conversion-option change cannot drift the payload and
// the validation seam apart.
//
// `includeEmbeddedStyleMap: false` (with the default style map kept) makes mammoth ignore a
// document-EMBEDDED style map, so a crafted docx cannot steer the emitted tag set outside
// mammoth's known default set - whose tags are all inside the shared HTML annotation policy's
// allowlist, the same policy the client extractor and the server tokenizer reduce by. Without
// this, an embedded style map could map a run/paragraph to an off-allowlist element (a
// `<fieldset>`/`<details>`/`<form>` block) that the trusted, UN-sanitized Canonical DOM would
// mount and the two block-aware engines would treat differently. The option MUST be passed as
// the second argument (the options object); mammoth silently ignores an unknown key placed in
// the first (input) argument, so a selector on such a doc must be validated through THIS
// function, never a bare `convertToHtml`.
export async function convertCanonicalHtml(
  headBytes: Buffer,
): Promise<CanonicalHtml> {
  const { value } = await mammoth.convertToHtml(
    { buffer: headBytes },
    { includeEmbeddedStyleMap: false },
  );
  return { html: value, reviewText: normalizeHtmlReviewText(value) };
}
