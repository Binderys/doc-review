import {
  HTML_ALLOWED_TAGS,
  HTML_BLOCK_TAGS,
  HTML_DROP_SUBTREE_TAGS,
} from "@doc-review/shared";

// Produces an HTML document's authoritative normalized review-text from its exact-head
// bytes (#66), the HTML analogue of `mirror-review-text.ts` for Markdown. The server has
// no browser DOM, so it cannot run the client's DOMPurify + block-aware DOM walk
// (`sanitizeHtml.ts` + `containerText.ts`). This reproduces the SAME normalized text with
// a dependency-free HTML tokenizer that applies the SAME allowlist and block semantics,
// so both sides yield the same visible-text sequence for the same head: the client ships
// this string on the html payload and computes its rendered-text selector against it, and
// the server reproduces it here to validate a submitted selector's quote.
//
// It mirrors the client's two-stage reduction in one pass:
//   1. sanitize (`sanitizeHtml.ts`): a `<script>`/`<style>`/`<head>` subtree is DROPPED
//      whole (its text never leaks as inert content); any other disallowed tag is
//      UNWRAPPED (the element is gone, its inner text survives in document order); only
//      the allowlisted tags remain.
//   2. block-aware extraction (`containerText.ts`): the surviving text is joined with a
//      block boundary around each block-level element and hard break, an `<img>`
//      flattens to its `alt` text, and inline markup passes through as its text.
// The three tag tables are the shared HTML annotation policy (`@doc-review/shared`), the same
// tables the client sanitizer and DOM walk use, so a change to the policy changes both
// engines at once (the paired counter-fixtures catch any residual divergence).

// The sanitize allowlist: only these survive; every other tag is unwrapped (its text
// kept) unless it is a dropped-subtree tag below.
const ALLOWED_TAGS = new Set<string>(HTML_ALLOWED_TAGS);

// The block boundary set, intersected with the allowlist: `details`/`fieldset`/`form` are
// in the shared block set but are UNWRAPPED by the sanitizer, so they never reach a block
// walk of the sanitized copy and emit no boundary here either.
const BLOCK_TAGS = new Set<string>(
  HTML_BLOCK_TAGS.filter((tag) => ALLOWED_TAGS.has(tag)),
);

// Tags whose entire subtree is dropped, contents and all - `<script>`/`<style>` bodies
// never leak as inert text (DOMPurify's forbidden-contents), and `<head>` content is not
// part of the sanitized body copy.
const DROP_SUBTREE_TAGS = new Set<string>(HTML_DROP_SUBTREE_TAGS);

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

// Decodes the HTML entities a browser's text-node decoding would resolve, for the common
// named set plus numeric references. An unrecognized entity is left verbatim: the client
// DOM would decode it, so an exotic entity inside a quote simply fails to locate against
// the rendered document (fail-closed), never mis-paints - the same residual the client's
// `containerText.ts` documents for text the two sides derive differently.
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, body) => {
    if (body[0] === "#") {
      const codePoint =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(codePoint) || codePoint <= 0) return match;
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return match;
      }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

// Reads a start tag's `alt` attribute value (decoded), or "" - the only attribute the
// review-text needs (an `<img>` flattens to its alt text). Attribute values may be
// single-, double-, or unquoted; nothing else about the tag's attributes is read.
function readAlt(tagBody: string): string {
  const match = /(?:^|\s)alt\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(
    tagBody,
  );
  if (!match) return "";
  return decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
}

// The index of a tag's closing `>`, scanned quote-aware from `from` so a `>` inside a
// single- or double-quoted attribute value (e.g. `<img alt="A > B">`) does not end the
// tag early - which would truncate the tag and leak its tail into the review-text.
// Returns -1 when the tag is never closed.
function findTagEnd(html: string, from: number): number {
  let quote: '"' | "'" | null = null;
  for (let index = from; index < html.length; index += 1) {
    const char = html[index];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return index;
    }
  }
  return -1;
}

export function normalizeHtmlReviewText(headHtml: string): string {
  let out = "";
  let index = 0;

  // A block boundary: one newline, deduped so adjacent boundaries collapse and a leading
  // boundary is never emitted (mirrors `containerText.ts` appendSeparator).
  const separator = (): void => {
    if (out.length === 0 || out.endsWith("\n")) return;
    out += "\n";
  };

  const length = headHtml.length;
  while (index < length) {
    const lt = headHtml.indexOf("<", index);
    if (lt === -1) {
      out += decodeEntities(headHtml.slice(index));
      break;
    }
    if (lt > index) {
      out += decodeEntities(headHtml.slice(index, lt));
    }

    // Comment / CDATA: drop through its terminator.
    if (headHtml.startsWith("<!--", lt)) {
      const end = headHtml.indexOf("-->", lt + 4);
      index = end === -1 ? length : end + 3;
      continue;
    }
    // Declaration (`<!doctype ...>`) or processing instruction (`<? ... >`): drop the tag.
    if (headHtml[lt + 1] === "!" || headHtml[lt + 1] === "?") {
      const end = findTagEnd(headHtml, lt + 1);
      index = end === -1 ? length : end + 1;
      continue;
    }

    const gt = findTagEnd(headHtml, lt + 1);
    if (gt === -1) {
      // An unterminated tag: no more structure to read.
      out += decodeEntities(headHtml.slice(lt));
      break;
    }

    const isEnd = headHtml[lt + 1] === "/";
    const inner = headHtml.slice(lt + (isEnd ? 2 : 1), gt);
    // Tag names include hyphens, so a custom element (`<script-x>`, `<img-x>`) is its
    // OWN name, never collapsed to a known tag: `<script-x>` is not the `script`
    // drop-subtree tag, and `<img-x alt=...>` is not an `<img>` alt flatten. Collapsing
    // to `script`/`img` silently diverges from the browser DOM (which unwraps the custom
    // element and keeps its text), and a divergence is a wrong-text hazard.
    const nameMatch = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(inner);
    if (!nameMatch) {
      index = gt + 1;
      continue;
    }
    const tag = nameMatch[0].toLowerCase();
    index = gt + 1;

    if (isEnd) {
      if (BLOCK_TAGS.has(tag)) separator();
      continue;
    }

    if (DROP_SUBTREE_TAGS.has(tag)) {
      // Skip the whole subtree: jump past the matching end tag (script/style are raw text
      // and cannot nest; head cannot nest head). Only the real drop tags reach here (the
      // full tag name is extracted above, so `<script-x>` is never `script`), and the
      // close pattern matches that full name so `</script-x>` never closes a `<script>`.
      const closePattern = new RegExp(`</${tag}\\s*>`, "i");
      const rest = headHtml.slice(index);
      const close = closePattern.exec(rest);
      index = close ? index + close.index + close[0].length : length;
      continue;
    }

    if (tag === "br") {
      separator();
      continue;
    }
    if (tag === "img") {
      out += readAlt(inner);
      continue;
    }
    if (ALLOWED_TAGS.has(tag)) {
      if (BLOCK_TAGS.has(tag)) separator();
      continue;
    }
    // A disallowed, non-dropped tag is unwrapped: emit nothing for the tag itself; its
    // text children are appended as they are reached.
  }

  return out.trim();
}
