import type { FilePayload } from "@doc-review/api-contracts";
import { Injectable } from "@nestjs/common";
import { rawFileUrl, type FileRenderer, type RenderableFile } from "./renderer";

/**
 * The pdf renderer: for a changed .pdf file it ships a `blobUrl` pointing at the
 * shared blob-serving route (#10), which streams the head bytes with an
 * `application/pdf` content type for the browser's native viewer. It embeds no
 * bytes and fetches nothing - the route serves them on demand.
 */
@Injectable()
export class PdfRenderer implements FileRenderer {
  readonly format = "pdf" as const;

  render(file: RenderableFile): FilePayload {
    return {
      format: "pdf",
      blobUrl: rawFileUrl(file.owner, file.repo, file.prNumber, file.path),
    };
  }
}
