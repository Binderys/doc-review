import { marked, type Token, type Tokens } from "marked";

// A token whose readable text lives in nested inline/child tokens.
function hasChildTokens(token: Token): token is Token & { tokens: Token[] } {
  return (
    "tokens" in token && Array.isArray(token.tokens) && token.tokens.length > 0
  );
}

// A leaf token's literal text (`text`, `codespan`, `code`, raw `html`, ...).
function literalText(token: Token): string {
  return "text" in token && typeof token.text === "string" ? token.text : "";
}

// Marked's `Token` union carries a permissive `Generic` arm, so a bare switch on
// `type` leaves the structured tokens widened. These narrow to the real arms whose
// content lives outside `text`/`tokens`.
function isList(token: Token): token is Tokens.List {
  return token.type === "list";
}
function isListItem(token: Token): token is Tokens.ListItem {
  return token.type === "list_item";
}
function isTable(token: Token): token is Tokens.Table {
  return token.type === "table";
}

// Flattens a run of inline tokens: markup wrappers (strong, em, link, ...) recurse
// into their children so their markers are dropped; a hard break is a newline; a leaf
// yields its literal text. The lexer already strips inline markers into child tokens,
// so `**bold**` flattens to `bold` without a DOM.
function inlineText(tokens: Token[]): string {
  return tokens
    .map((token) => {
      if (token.type === "br") {
        return "\n";
      }
      if (hasChildTokens(token)) {
        return inlineText(token.tokens);
      }
      return literalText(token);
    })
    .join("");
}

// Flattens a table to its cells in reading order: header row first, then each body
// row, cells space-joined within a row and rows newline-joined.
function tableText(token: Tokens.Table): string {
  const rowText = (cells: Tokens.TableCell[]): string =>
    cells.map((cell) => inlineText(cell.tokens)).join(" ");
  return [rowText(token.header), ...token.rows.map(rowText)].join("\n");
}

// Flattens one block token's readable text. List and table content lives in `items`
// and `header`/`rows` rather than a top-level `text`/`tokens`, so those are traversed
// explicitly; code and raw HTML stay literal (deterministic; downstream sanitizing is
// not this seam's concern).
function blockText(token: Token): string {
  if (isList(token)) {
    return token.items.map(blockText).filter(Boolean).join("\n");
  }
  if (isListItem(token)) {
    return (token.tokens ?? []).map(blockText).filter(Boolean).join("\n");
  }
  if (isTable(token)) {
    return tableText(token);
  }
  switch (token.type) {
    case "space":
      return "";
    case "heading":
    case "paragraph":
      return inlineText(token.tokens ?? []);
    case "blockquote":
      return blocksText(token.tokens ?? []);
    case "code":
    case "html":
      return literalText(token);
    default:
      return hasChildTokens(token)
        ? inlineText(token.tokens)
        : literalText(token);
  }
}

// Joins block tokens in document order, dropping empties, with a blank-line boundary.
function blocksText(tokens: Token[]): string {
  return tokens.map(blockText).filter(Boolean).join("\n\n");
}

/**
 * Produces a Mirror's authoritative normalized review-text from its exact-head
 * markdown (#63). Deterministic and reproducible: the same head bytes always yield
 * the same string, so the server can both ship it on the md payload and reproduce it
 * to validate a rendered-text anchor's quote at post time. Block tokens are emitted
 * in document order, inline markup flattened to its text, and blocks separated by a
 * blank-line boundary - the text a reviewer reads in the rendered document, not the
 * source diff or the base revision.
 */
export function normalizeMirrorReviewText(headMarkdown: string): string {
  return blocksText(marked.lexer(headMarkdown));
}
