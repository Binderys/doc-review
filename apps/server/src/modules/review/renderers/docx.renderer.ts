import type { FilePayload } from "@doc-review/api-contracts";
import { Injectable } from "@nestjs/common";
import { GitHubSource } from "../../dashboard/github/github-source";
import { convertCanonicalHtml } from "./canonical-html";
import type { FileRenderer, RenderableFile } from "./renderer";

/**
 * The docx renderer: for a changed canonical (정본) docx it converts the head file to
 * HTML on the server via mammoth, with no diff - content diffs live in the md mirror
 * per the repo convention, and Word layout-fidelity loss is accepted by design (ADR
 * 0001). It fetches the head bytes through the injected GitHubSource seam (the same
 * seam the rest of the app reads GitHub with) and keeps them as a Buffer, since a
 * docx is a binary zip, not UTF-8 text. A deleted file has no head, so it renders
 * empty.
 *
 * It also ships `reviewText`, the rendered Canonical's authoritative normalized
 * review-text (#67), produced with the mounted HTML by the single owner of Canonical HTML
 * production (`convertCanonicalHtml`) - the same function the review service's validation
 * seam (`reproduceRenderedReviewText`) calls, so the mounted HTML and the reproduced
 * review-text can never drift apart. A deleted head yields an empty review-text.
 */
@Injectable()
export class DocxRenderer implements FileRenderer {
  readonly format = "docx" as const;

  constructor(private readonly source: GitHubSource) {}

  async render(file: RenderableFile): Promise<FilePayload> {
    if (file.changeType === "deleted") {
      return { format: "docx", renderedHead: "", reviewText: "" };
    }

    const slug = `${file.owner}/${file.repo}`;
    const blob = await this.source.fetchBlob(slug, file.ref, file.path);
    const { html, reviewText } = await convertCanonicalHtml(blob.bytes);

    return { format: "docx", renderedHead: html, reviewText };
  }
}
