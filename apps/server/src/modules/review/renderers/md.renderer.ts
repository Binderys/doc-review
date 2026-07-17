import type {
  FilePayload,
  WordDiff,
  WordDiffSegment,
} from "@doc-review/api-contracts";
import { Injectable } from "@nestjs/common";
import { diffWords } from "diff";
import { marked } from "marked";
import { GitHubSource } from "../../dashboard/github/github-source";
import { loadBaseAndHead } from "./blob-text";
import { normalizeMirrorReviewText } from "./mirror-review-text";
import type { FileRenderer, RenderableFile } from "./renderer";
import { buildSourceDiff } from "./source-diff";

/**
 * The md renderer: for a changed markdown file it produces two views per the parent
 * spec - a word-level source diff (base -> head) and the head rendered to HTML. It
 * also carries a line-addressable source diff so feedback can anchor to a head line
 * (#37), plus the Mirror's normalized review-text for rendered-text anchors (#63). It
 * fetches base and head text through the injected GitHubSource seam (the
 * same seam the rest of the app reads GitHub with). An added file has no base (empty base ->
 * an all-added diff); a deleted file has no head. Bytes decode as UTF-8.
 */
@Injectable()
export class MarkdownRenderer implements FileRenderer {
  readonly format = "md" as const;

  constructor(private readonly source: GitHubSource) {}

  async render(file: RenderableFile): Promise<FilePayload> {
    const { baseText, headText } = await loadBaseAndHead(this.source, file);

    const renderedHead = await marked.parse(headText);

    return {
      format: "md",
      diff: toWordDiff(baseText, headText),
      sourceDiff: buildSourceDiff(baseText, headText),
      renderedHead,
      reviewText: normalizeMirrorReviewText(headText),
    };
  }
}

// Maps a word-level base -> head diff onto the contract's WordDiff: one segment per
// run, `added`/`removed` set only on changed runs (unchanged context carries neither).
function toWordDiff(baseText: string, headText: string): WordDiff {
  return diffWords(baseText, headText).map((change) => {
    const segment: WordDiffSegment = { value: change.value };
    if (change.added) {
      segment.added = true;
    }
    if (change.removed) {
      segment.removed = true;
    }
    return segment;
  });
}
