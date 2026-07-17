import type { GitHubSource } from "../../dashboard/github/github-source";
import type { RenderableFile } from "./renderer";

// Fetches a file blob through the GitHubSource seam and decodes it as UTF-8 text.
async function fetchText(
  source: GitHubSource,
  slug: string,
  ref: string,
  path: string,
): Promise<string> {
  const blob = await source.fetchBlob(slug, ref, path);
  return blob.bytes.toString("utf-8");
}

// Loads a changed file's base and head text (base -> head), applying the one shared
// side-existence policy: an added file has no base (empty base -> an all-added diff),
// a deleted file has no head. The content renderers that diff base -> head (md, html)
// share this, so the policy has one owner - a rename-aware base path (#43) changes
// here, not in each renderer.
export async function loadBaseAndHead(
  source: GitHubSource,
  file: RenderableFile,
): Promise<{ baseText: string; headText: string }> {
  const slug = `${file.owner}/${file.repo}`;
  const baseText =
    file.changeType === "added"
      ? ""
      : await fetchText(source, slug, file.baseRef, file.basePath);
  const headText =
    file.changeType === "deleted"
      ? ""
      : await fetchText(source, slug, file.ref, file.path);
  return { baseText, headText };
}
