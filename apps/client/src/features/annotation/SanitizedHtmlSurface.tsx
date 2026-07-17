import type { FeedbackAnchor, ReviewComment } from "@doc-review/api-contracts";
import { useMemo, type ReactElement } from "react";
import type { RenderedAnnotatorFactory } from "./renderedAnnotator";
import { RenderedAnnotationSurface } from "./RenderedAnnotationSurface";
import { sanitizeHtml } from "./sanitizeHtml";

type SubmitFeedback = (anchor: FeedbackAnchor) => void | Promise<void>;

export type SanitizedHtmlSurfaceProps = {
  raw: string;
  // The document's authoritative normalized review-text, reproduced server-side from the
  // exact head (#66). Every durable selector offset is computed against it, never against
  // the sanitized DOM's own text.
  reviewText?: string;
  path?: string;
  comments?: ReviewComment[];
  onSubmitFeedback?: SubmitFeedback;
  annotatorFactory?: RenderedAnnotatorFactory;
};

const HINT = (
  <p className="html-safe-copy__hint">
    Safe rendered copy: scripts, controls, embeds, external resources, and
    authored styles are removed. Select text to comment on the rendered HTML.
  </p>
);

// The sanitized HTML annotation copy (issue #65), now the annotation surface (issue #66):
// a same-DOM, selectable review surface beside the scriptless sandbox. It renders the
// DOMPurify-reduced authored HTML - safe, selectable text in document order - and wires
// it into the shared rendered-text annotation engine (the same one the Mirror uses), so a
// selection becomes a highlight-linked draft card and submits through the durable local
// feedback lifecycle. The sibling sandboxed iframe keeps the raw authored bytes for visual
// comparison.
export function SanitizedHtmlSurface({
  raw,
  reviewText = "",
  path = "",
  comments = [],
  onSubmitFeedback,
  annotatorFactory,
}: SanitizedHtmlSurfaceProps): ReactElement {
  const safeHtml = useMemo(() => sanitizeHtml(raw), [raw]);
  // `null` means DOMPurify had no DOM (server-side render): the copy cannot be produced
  // safely here, so present an explicit unavailable state rather than an empty div that
  // reads as a successfully-sanitized empty document. The sandboxed rendering below
  // remains the fallback. An empty STRING is a genuinely-empty sanitized document.
  if (safeHtml === null) {
    return (
      <div className="html-safe-copy">
        {HINT}
        <div
          className="html-safe-copy__text"
          data-html-safe-copy
          data-state="unavailable"
        >
          The safe rendered copy is unavailable in this environment; use the
          sandboxed rendering below.
        </div>
      </div>
    );
  }

  return (
    <RenderedAnnotationSurface
      path={path}
      renderedHtml={safeHtml}
      reviewText={reviewText}
      comments={comments}
      onSubmitFeedback={onSubmitFeedback}
      annotatorFactory={annotatorFactory}
      hint={HINT}
      wrapperClassName="html-safe-copy"
      surfaceClassName="html-safe-copy__text mirror-annotation__text"
      safeCopy
    />
  );
}
