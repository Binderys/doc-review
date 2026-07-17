import type { ChangeType, FilePayload } from "@doc-review/api-contracts";
import { Inject, Injectable } from "@nestjs/common";

// The formats the dispatch keys on. `download` is the catch-all fallback; every
// other value maps to a renderer a later slice registers (#8 md, #9 docx, #10 html
// + pdf). Kept in lockstep with the contract's `FilePayload` discriminant.
export type FileFormat = FilePayload["format"];

// The input a renderer needs to produce a payload. `repo` is the repo name only
// (not the `owner/name` slug); `owner`, `repo`, and `prNumber` reconstruct the
// review-surface route paths, and `${owner}/${repo}` reconstructs the GitHub slug a
// content renderer fetches blobs with. `ref` is the exact PR head and `baseRef` the base,
// so a renderer can diff base -> head; `changeType` tells it which side exists (an
// added file has no base, a deleted file no head). `basePath` is the file's path on
// the base side: it equals `path` except for a renamed/copied file, whose base blob
// lives at its previous path (#43), so a content renderer diffs the base there. The
// download renderer uses only the route-path fields.
export type RenderableFile = {
  owner: string;
  repo: string;
  prNumber: number;
  path: string;
  basePath: string;
  ref: string;
  baseRef: string;
  changeType: ChangeType;
};

// One format's renderer. A slice adds a format by registering a renderer whose
// `format` matches, without touching the others.
export interface FileRenderer {
  readonly format: FileFormat;
  render(file: RenderableFile): FilePayload | Promise<FilePayload>;
}

// DI token for the collected set of renderers. The review module provides it via a
// factory that returns the injected renderers as an array, so a later slice adds one
// renderer without editing the registry or the other renderers.
export const FILE_RENDERERS = Symbol("FILE_RENDERERS");

// The route path to a file's raw HEAD bytes, served by the blob-serving GET route
// (#10). The path rides as an encoded query param, avoiding a mid-route wildcard so
// it works cleanly on Express/NestJS routing. The HTML authored comparison points its
// protected `comparisonUrl` here with its exact head pinned; the `pdf` arm and
// `download` fallback use the live-head shape for `blobUrl`. This is the one owner of
// the route shape.
export function rawFileUrl(
  owner: string,
  repo: string,
  prNumber: number,
  path: string,
  ref?: string,
): string {
  const pinnedRef = ref ? `&ref=${encodeURIComponent(ref)}` : "";
  return `/pr/${owner}/${repo}/${prNumber}/raw?path=${encodeURIComponent(path)}${pinnedRef}`;
}

// Detects a file's format from its extension. Anything unrecognized (including
// unrenderable formats like xlsx/pptx) falls to `download`, so no file is dropped.
export function detectFormat(path: string): FileFormat {
  const dot = path.lastIndexOf(".");
  const ext = dot === -1 ? "" : path.slice(dot).toLowerCase();
  switch (ext) {
    case ".md":
      return "md";
    case ".docx":
      return "docx";
    case ".htm":
    case ".html":
      return "html";
    case ".pdf":
      return "pdf";
    default:
      return "download";
  }
}

/**
 * The renderer-dispatch seam: detects each file's format and routes it to the
 * matching registered renderer, falling back to the `download` renderer for any
 * format not yet registered. In #7 only the download renderer is registered, so
 * every file resolves to a download payload; later slices register their renderer
 * and fill their arm, and the fallback shrinks accordingly.
 */
@Injectable()
export class FileRendererRegistry {
  private readonly byFormat = new Map<FileFormat, FileRenderer>();
  private readonly fallback: FileRenderer;

  constructor(@Inject(FILE_RENDERERS) renderers: FileRenderer[]) {
    for (const renderer of renderers) {
      this.byFormat.set(renderer.format, renderer);
    }
    const download = this.byFormat.get("download");
    if (!download) {
      throw new Error(
        "A download renderer must be registered as the default fallback.",
      );
    }
    this.fallback = download;
  }

  render(file: RenderableFile): FilePayload | Promise<FilePayload> {
    const format = detectFormat(file.path);
    const renderer = this.byFormat.get(format) ?? this.fallback;
    return renderer.render(file);
  }
}
