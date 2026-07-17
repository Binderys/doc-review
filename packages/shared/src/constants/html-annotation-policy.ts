// The single source of the HTML annotation-copy policy (#65/#66): which tags survive the
// sanitize, which are block-level, and which are dropped whole. The client sanitizer
// (`sanitizeHtml.ts`) and block-aware DOM walk (`containerText.ts`) and the server's
// dependency-free review-text producer (`html-review-text.ts`) each derive their own view
// from these tables, so the two independently-implemented engines share ONE written
// policy - a change here changes every engine, and the paired counter-fixtures catch drift.
//
// All names are lowercase; a DOM consumer that compares against `Element.tagName`
// uppercases them.

// The sanitize allowlist: only these tags survive; every other tag is unwrapped (its text
// kept in document order) unless it is a dropped-subtree tag below. Block/structural text
// containers first, then inline text-level semantics.
export const HTML_ALLOWED_TAGS = [
  "address",
  "article",
  "aside",
  "blockquote",
  "caption",
  "col",
  "colgroup",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "br",
  "cite",
  "code",
  "data",
  "del",
  "dfn",
  "em",
  "i",
  "img",
  "ins",
  "kbd",
  "mark",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "u",
  "var",
  "wbr",
] as const;

// The attributes that survive: text semantics (`alt`/`title`) and table reading structure
// (`colspan`/`rowspan`). No URL-, style-, or event-bearing attribute is allowed.
export const HTML_ALLOWED_ATTRS = [
  "alt",
  "title",
  "colspan",
  "rowspan",
] as const;

// The block-level set a boundary is inserted around when extracting visible text. This is
// the FULL block set: it includes `details`/`fieldset`/`form`, which the sanitizer unwraps
// (so they never reach the DOM walk) but which the walk lists generically. A consumer that
// only sees sanitized tags (the server producer) intersects this with the allowlist.
export const HTML_BLOCK_TAGS = [
  "address",
  "article",
  "aside",
  "blockquote",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
] as const;

// Tags whose entire subtree is dropped, contents and all: `<script>`/`<style>` bodies must
// never leak as inert text, and `<head>` content is not part of the sanitized body copy.
// The client relies on DOMPurify's forbidden-contents for script/style; the server, with
// no DOM, drops these subtrees explicitly.
export const HTML_DROP_SUBTREE_TAGS = ["script", "style", "head"] as const;
