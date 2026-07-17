import type { RenderedAnnotatorFactory } from "./renderedAnnotator";

// The single lazy loader for the production rendered-annotation adapter. The dynamic
// import stays here so Recogito is code-split into its own chunk and never pulled into a
// non-browser render, and so the review surface has exactly one loader seam: it is
// invoked only where rendered annotation is usable (the Mirror, Canonical, and sanitized
// HTML surfaces), and tests can spy on it to prove dashboard, PDF, downloads, deleted
// files, and source-only fallbacks never reach the adapter.
export async function loadRenderedAnnotator(): Promise<RenderedAnnotatorFactory> {
  const module = await import("./recogitoRenderedAnnotator");
  return module.createRecogitoRenderedAnnotator;
}
