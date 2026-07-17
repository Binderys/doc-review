import type { SourceDiff, SourceDiffLine } from "@doc-review/api-contracts";
import { diffLines } from "diff";

/**
 * Builds a line-addressable source diff (base -> head) for the review surface
 * (issue #37). Each line carries its role and its line numbers: a `context` line
 * exists on both sides (both `oldLine` and `newLine`), an `added` line only at the
 * head (`newLine`), a `removed` line only at the base (`oldLine`). A `removed` line
 * has no head position, so it is display context, not a valid head anchor - matching
 * the contract's two-anchor invariant. Line numbers are 1-based and count every line
 * of each side in order.
 */
export function buildSourceDiff(
  baseText: string,
  headText: string,
): SourceDiff {
  const lines: SourceDiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;

  for (const part of diffLines(baseText, headText)) {
    for (const text of splitLines(part.value)) {
      if (part.added) {
        lines.push({ newLine, text, change: "added" });
        newLine++;
      } else if (part.removed) {
        lines.push({ oldLine, text, change: "removed" });
        oldLine++;
      } else {
        lines.push({ oldLine, newLine, text, change: "context" });
        oldLine++;
        newLine++;
      }
    }
  }

  return lines;
}

// Splits a diff hunk's value into its lines. `diffLines` keeps the trailing newline
// on each line, so a hunk value ends with an empty element we drop; a final line
// without a trailing newline is kept as-is.
function splitLines(value: string): string[] {
  const parts = value.split("\n");
  if (parts.length > 0 && parts[parts.length - 1] === "") {
    parts.pop();
  }
  return parts;
}
