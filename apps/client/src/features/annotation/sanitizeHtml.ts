import { HTML_ALLOWED_ATTRS, HTML_ALLOWED_TAGS } from "@doc-review/shared";
import DOMPurify, { type Config } from "dompurify";

// The safe HTML annotation copy (spec #56, issue #65): untrusted authored HTML reduced
// to selectable, safe semantics for the application DOM. The scriptless sandbox keeps
// the authored VISUAL truth; this copy keeps the TEXT and its document order. We decide
// safety with an allowlist, not a denylist, so the posture does not depend on
// DOMPurify's evolving defaults: only text-structural tags and a handful of
// non-loading, non-styling attributes survive.
//
// The allowlist and its allowed attributes are the shared HTML annotation policy
// (`@doc-review/shared`), so this sanitizer, the block-aware DOM walk, and the server's
// review-text producer all reduce untrusted HTML by ONE written policy.
//
// Excluded by construction (not on the allowlist):
// - executable: `<script>` and every `on*` event-handler attribute;
// - active controls: `<form>`, `<input>`, `<button>`, `<select>`, `<textarea>`, and
//   the native `<details>`/`<summary>` disclosure widget (#59 keeps active controls
//   out of the annotation copy);
// - embedded documents: `<iframe>`, `<object>`, `<embed>`;
// - external resources: no `src`/`srcset`/`href` reaches the copy, so nothing loads or
//   navigates - an `<img>` survives for its `alt` text alone, never a network fetch;
// - authored styles: `<style>` and the `style` attribute.
//
// Two removal behaviors, both relied on: a disallowed STRUCTURAL/text tag (a control, a
// disclosure widget, an embed) is UNWRAPPED - the element is gone but its inner text
// survives in document order. A `<script>`/`<style>` subtree is DROPPED ENTIRELY,
// contents and all: DOMPurify's forbidden-contents set removes their text so a script or
// stylesheet body never leaks into the copy as inert text, even with KEEP_CONTENT.
const ALLOWED_TAGS = [...HTML_ALLOWED_TAGS];

// No URL-bearing, style-bearing, or event attribute is allowed. `alt`/`title` carry
// text semantics; `colspan`/`rowspan` keep a table's reading structure intact.
const ALLOWED_ATTR = [...HTML_ALLOWED_ATTRS];

const SANITIZE_CONFIG: Config = {
  ALLOWED_TAGS,
  ALLOWED_ATTR,
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  // Unwrap a disallowed structural/text tag rather than dropping its subtree, so the
  // visible text of a removed element (e.g. a `<details>`/`<summary>` widget) survives in
  // document order while the element itself is gone. This does NOT re-admit script or
  // stylesheet bodies: `<script>`/`<style>` are in DOMPurify's forbidden-contents set, so
  // their subtrees are dropped entirely regardless of this flag. Pinned so it is durable.
  KEEP_CONTENT: true,
  // Return the body's inner HTML string, not a whole document or a DOM node.
  WHOLE_DOCUMENT: false,
};

// Reduces untrusted authored HTML to the safe, selectable semantics copy. Returns `null`
// - not `""` - where DOMPurify has no DOM to work against (server-side rendering has no
// `window`), so an UNSUPPORTED environment is distinguishable from a genuinely-empty
// sanitized document; the surface renders an explicit unavailable state for `null`. In
// the browser the copy is a sanitized HTML string (possibly `""` for empty input).
export function sanitizeHtml(raw: string): string | null {
  if (!DOMPurify.isSupported) return null;
  return DOMPurify.sanitize(raw, SANITIZE_CONFIG);
}
