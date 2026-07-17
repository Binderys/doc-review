import type { FilePayload } from "@doc-review/api-contracts";
import { Injectable } from "@nestjs/common";
import { rawFileUrl, type FileRenderer, type RenderableFile } from "./renderer";

/**
 * The default fallback renderer: produces a `download` payload for any file whose
 * format has no dedicated renderer yet, so the file list is always complete. Its
 * `blobUrl` points at the shared blob-serving route (#10); `filename` is the
 * basename. It never fetches bytes - the route streams them on demand.
 */
@Injectable()
export class DownloadRenderer implements FileRenderer {
  readonly format = "download" as const;

  render(file: RenderableFile): FilePayload {
    const filename = file.path.slice(file.path.lastIndexOf("/") + 1);

    return {
      format: "download",
      blobUrl: rawFileUrl(file.owner, file.repo, file.prNumber, file.path),
      filename,
    };
  }
}
