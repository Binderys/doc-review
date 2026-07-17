import type { FilePayload } from "@doc-review/api-contracts";
import { Injectable } from "@nestjs/common";
import { GitHubSource } from "../../dashboard/github/github-source";
import { loadBaseAndHead } from "./blob-text";
import { normalizeHtmlReviewText } from "./html-review-text";
import { rawFileUrl, type FileRenderer, type RenderableFile } from "./renderer";
import { buildSourceDiff } from "./source-diff";

/**
 * The html renderer: for a changed .html/.htm file it ships the file's RAW head
 * content, unmodified - embedded scripts and resource URLs remain in the authored
 * bytes, while `comparisonUrl` serves those same head bytes under the raw route's
 * no-egress policy (#78). Alongside the raw head it carries a line-addressable source
 * diff (base -> head) so feedback can anchor to a head line (#37), and the sanitized
 * copy's normalized review-text so a rendered-text anchor can address a span of the
 * visible safe text (#66). It fetches base and head bytes through the injected
 * GitHubSource seam (the same seam the rest of the app reads GitHub with) and decodes
 * them as UTF-8. An added file has no base (empty base -> an all-added diff); a deleted
 * file has no head, so it ships an empty raw head (whose review-text is empty).
 */
@Injectable()
export class HtmlRenderer implements FileRenderer {
  readonly format = "html" as const;

  constructor(private readonly source: GitHubSource) {}

  async render(file: RenderableFile): Promise<FilePayload> {
    const { baseText, headText } = await loadBaseAndHead(this.source, file);

    return {
      format: "html",
      raw: headText,
      comparisonUrl:
        file.changeType === "deleted"
          ? null
          : rawFileUrl(
              file.owner,
              file.repo,
              file.prNumber,
              file.path,
              file.ref,
            ),
      sourceDiff: buildSourceDiff(baseText, headText),
      reviewText: normalizeHtmlReviewText(headText),
    };
  }
}
