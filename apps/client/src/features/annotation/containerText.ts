import { HTML_BLOCK_TAGS } from "@doc-review/shared";
import {
  findQuoteSpan,
  type QuoteSpan,
  type QuoteWithContext,
} from "./renderedTextSelector";

// How much rendered-document context to report around a selection.
const CONTEXT_WINDOW = 32;

// Raw `container.textContent` concatenates adjacent block elements with NO separator
// ("review" + "carefully" -> "reviewcarefully"), a merge whitespace-collapsing cannot
// undo, while the server's review-text joins blocks with whitespace. We instead extract
// the rendered text block-aware so, for content the Mirror renderer produces, extracted
// text and the server review-text differ only in whitespace, and everything downstream
// matches by quote+context and fails closed on any residual divergence.
//
// Mirroring the server's inline flatten (`mirror-review-text.ts` inlineText):
// - block-level boundaries -> a separator (blocks are joined with whitespace);
// - a hard break `<br>` -> a separator (the server emits "\n" for a `br` token);
// - an `<img>` -> its `alt` text (the image token flattens to its alt `.text`);
// - links flatten to display text only (no href), code spans and escapes stay literal
//   text, and strong/em/etc. recurse to their text - all already DOM-consistent.
// Known residuals stay fail-closed rather than reconciled: literal inline HTML the
// server keeps but the DOM strips (the cross-tag case), raw HTML BLOCKS the server keeps
// literally while the DOM exposes only their child text (mirror-review-text.ts keeps the
// `html` token's raw text), and raw HTML entities the server keeps encoded but the DOM
// decodes. With the painting path requiring context agreement even on a unique match,
// each of these declines to locate instead of mis-painting a unique-but-wrong span.
//
// Fabricated (server-only) text - an image's alt, and block/break separators - has no
// home in the DOM's own text, so it is tracked and any located quote span that overlaps
// it is refused: fabricated text may inform a context window, but a quote must never be
// anchored on or across it.
// The shared block set (`@doc-review/shared`), uppercased to compare against `Element.tagName`.
const BLOCK_TAGS = new Set(HTML_BLOCK_TAGS.map((tag) => tag.toUpperCase()));

// The block-aware text plus offset maps and a fabricated mask. `toContent[blockOffset]`
// is the offset into the raw `textContent` (the coordinate a DOM range / the highlight
// renderer uses); `toBlock[contentOffset]` is the reverse. `fabricated[blockOffset]` is
// true for a block char with no home in the DOM's own text - a separator or an image's
// alt - so a quote span overlapping one can be refused.
export type BlockExtraction = {
  text: string;
  toContent: number[];
  toBlock: number[];
  fabricated: boolean[];
};

export function extractBlockText(container: HTMLElement): BlockExtraction {
  let text = "";
  const toContent: number[] = [];
  const toBlock: number[] = [];
  const fabricated: boolean[] = [];
  let contentIndex = 0;

  const appendSeparator = (): void => {
    if (text.length === 0 || text.endsWith("\n")) return;
    text += "\n";
    toContent.push(contentIndex);
    fabricated.push(true);
  };

  // Appends text the server review-text carries but that has no home in the DOM's own
  // text content (an image's alt), mapping each code unit to the current content
  // boundary and marking it fabricated. Iterates code units (not code points) to keep
  // offsets aligned with findQuoteSpan and the sibling text-node loop.
  const appendServerOnlyText = (value: string): void => {
    for (let index = 0; index < value.length; index += 1) {
      text += value[index];
      toContent.push(contentIndex);
      fabricated.push(true);
    }
  };

  const walk = (node: Node): void => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const data = (child as Text).data;
        for (let index = 0; index < data.length; index += 1) {
          toBlock[contentIndex] = text.length;
          text += data[index];
          toContent.push(contentIndex);
          fabricated.push(false);
          contentIndex += 1;
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const element = child as Element;
        const tag = element.tagName;
        // A hard break is a separator (the server emits "\n" for a `br` token).
        if (tag === "BR") {
          appendSeparator();
          return;
        }
        // An image flattens to its alt text (the server's image token `.text`).
        if (tag === "IMG") {
          appendServerOnlyText(element.getAttribute("alt") ?? "");
          return;
        }
        const isBlock = BLOCK_TAGS.has(tag);
        if (isBlock) appendSeparator();
        walk(element);
        if (isBlock) appendSeparator();
      }
    });
  };

  walk(container);
  // Drop a trailing block separator so a document-final quote's suffix is not padded.
  if (text.endsWith("\n")) {
    text = text.slice(0, -1);
    toContent.pop();
    fabricated.pop();
  }
  return { text, toContent, toBlock, fabricated };
}

// Locates a quote+context in the rendered container and returns its span in raw
// `textContent` offsets (so a DOM range or the highlight renderer can revive it). This
// is the painting path: it requires context agreement even on a unique match, and it
// fails closed (null) when the quote is absent, its context cannot single out one
// occurrence, or the located span overlaps any fabricated (server-only) text - a quote
// must never anchor on or across an image's alt or a block/break separator.
export function locateQuoteInContainer(
  container: HTMLElement,
  target: QuoteWithContext,
): QuoteSpan | null {
  const { text, toContent, fabricated } = extractBlockText(container);
  const span = findQuoteSpan(text, target, { requireContext: true });
  if (!span) return null;
  for (let index = span.start; index < span.end; index += 1) {
    if (fabricated[index]) return null;
  }
  return { start: toContent[span.start], end: toContent[span.end - 1] + 1 };
}

// Reads the block-aware context around a raw-`textContent` span, so a fresh selection's
// reported prefix/suffix mirror the review-text's block-join semantics.
export function readContainerContext(
  container: HTMLElement,
  contentStart: number,
  contentEnd: number,
): { prefix: string; suffix: string } {
  const { text, toBlock } = extractBlockText(container);
  const blockStart = toBlock[contentStart] ?? text.length;
  const lastContent = contentEnd - 1;
  const blockEnd =
    lastContent >= 0 && toBlock[lastContent] !== undefined
      ? toBlock[lastContent] + 1
      : blockStart;
  return {
    prefix: text.slice(Math.max(0, blockStart - CONTEXT_WINDOW), blockStart),
    suffix: text.slice(blockEnd, blockEnd + CONTEXT_WINDOW),
  };
}
