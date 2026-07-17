import type { FeedbackAnchor, ReviewComment } from "@doc-review/api-contracts";
import {
  forwardRef,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import type {
  RenderedAnnotator,
  RenderedAnnotatorFactory,
  RenderedAnnotatorHandlers,
  RenderedHighlight,
  RenderedTextSelection,
} from "./renderedAnnotator";
import { loadRenderedAnnotator } from "./loadRenderedAnnotator";
import {
  buildRenderedTextAnchor,
  isRenderedComment,
  locateSelection,
  verifyRenderedComment,
} from "./renderedTextSelector";

// The id of the pending, unsubmitted draft highlight. Distinct from any server comment
// id so the draft and saved highlights coexist in the adapter's rendered set.
const DRAFT_HIGHLIGHT_ID = "__rendered_draft__";

// The rendered document HTML, in a memoized subtree so React commits its innerHTML once
// and never re-applies it on a parent re-render. That is essential: the annotation
// adapter (Recogito, or the test fake) mutates this element's DOM to draw highlights,
// and a React re-applied innerHTML would wipe those highlights on every draft edit or
// paint-state update. Every prop is a stable primitive (the sanitized/rendered string,
// the class string, the safe-copy flag) so the memo never re-commits from a fresh object.
const RenderedSurface = memo(
  forwardRef<
    HTMLDivElement,
    { html: string; className: string; safeCopy: boolean }
  >(function RenderedSurface({ html, className, safeCopy }, ref) {
    return (
      <div
        ref={ref}
        className={className}
        data-annotation-surface
        // The HTML annotation copy is also the sanitized safe copy (#65/#66): the same
        // element the security tests assert on and the adapter selects/paints in.
        data-html-safe-copy={safeCopy ? "" : undefined}
        data-state={safeCopy ? "ready" : undefined}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }),
);

type SubmitFeedback = (anchor: FeedbackAnchor) => void | Promise<void>;

export type RenderedAnnotationSurfaceProps = {
  path: string;
  // The rendered document HTML: the single, visible surface the reviewer selects in - a
  // Mirror's rendered head, or the sanitized HTML annotation copy.
  renderedHtml: string;
  // The document's authoritative normalized review-text: every durable selector and
  // highlight offset is computed against it (never rendered as a second copy).
  reviewText: string;
  // The current round's comments; rendered-scope comments on this document become rail
  // cards, and the verified ones become highlights.
  comments: ReviewComment[];
  onSubmitFeedback?: SubmitFeedback;
  // Injected in tests as a fake; production defaults to the Recogito-backed adapter,
  // loaded lazily so the review surface never pulls Recogito into a non-browser render.
  annotatorFactory?: RenderedAnnotatorFactory;
  // The instruction line, supplied by the caller so each format labels its own surface.
  hint: ReactNode;
  // Presentation hooks so a Mirror and the HTML safe copy can share this one engine while
  // keeping their own container classes and the safe-copy data attributes.
  wrapperClassName?: string;
  surfaceClassName?: string;
  safeCopy?: boolean;
};

// A reviewer selects text directly in the rendered document; the selection becomes a
// highlight-linked draft card in a Word-style right rail, submits through the existing
// local feedback lifecycle, reloads with the saved comment, and navigates from a saved
// card back to its verified passage. Recogito lives behind the adapter seam; doc-review
// owns the durable selector and comment state. One engine for every rendered format
// (Mirror #64, sanitized HTML #66); the format supplies the rendered HTML, its
// review-text, and its presentation.
export function RenderedAnnotationSurface({
  path,
  renderedHtml,
  reviewText,
  comments,
  onSubmitFeedback,
  annotatorFactory,
  hint,
  wrapperClassName = "mirror-annotation",
  surfaceClassName = "review-file__md-rendered mirror-annotation__text",
  safeCopy = false,
}: RenderedAnnotationSurfaceProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  // The adapter is held in state (not a ref) so the paint effect re-keys to the actual
  // instance: a remount that destroys and recreates the adapter re-runs the paint even
  // if the surrounding renders batch, and never leaves a stale painted set behind.
  const [annotator, setAnnotator] = useState<RenderedAnnotator | null>(null);
  const [draft, setDraft] = useState<RenderedTextSelection | null>(null);
  const [draftBody, setDraftBody] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  // The ids the adapter actually painted. A comment can be verified against the
  // review-text yet fail to locate in the independently-derived rendered document
  // (fail-closed); its rail card must then present like a drifted one - quote only, no
  // navigation to a highlight that was never drawn.
  const [paintedIds, setPaintedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const renderedComments = useMemo(
    () =>
      comments
        .filter(isRenderedComment)
        .filter((comment) => comment.path === path),
    [comments, path],
  );

  // Highlights doc-review wants drawn: every verified saved comment plus the pending draft.
  // A drifted or otherwise unverified comment yields no highlight, so its stored
  // position is never drawn (issue #64 AC5).
  const highlights = useMemo<RenderedHighlight[]>(() => {
    const drawn = renderedComments
      .map((comment) => verifyRenderedComment(reviewText, comment))
      .filter(
        (highlight): highlight is RenderedHighlight => highlight !== null,
      );
    if (draft) {
      drawn.push({
        id: DRAFT_HIGHLIGHT_ID,
        quote: draft.quote,
        prefix: draft.prefix,
        suffix: draft.suffix,
      });
    }
    return drawn;
  }, [renderedComments, reviewText, draft]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    const handlers: RenderedAnnotatorHandlers = {
      onSelect: (selection) => {
        if (!selection) {
          setDraft(null);
          return;
        }
        const located = locateSelection(reviewText, selection);
        setDraft(located);
        if (located) setDraftBody("");
      },
      onActivate: (id) => setActiveId(id),
    };

    let created: RenderedAnnotator | null = null;
    const mount = (factory: RenderedAnnotatorFactory): void => {
      if (cancelled) return;
      created = factory({ container, handlers });
      setAnnotator(created);
    };

    if (annotatorFactory) {
      mount(annotatorFactory);
    } else {
      void loadRenderedAnnotator()
        .then((factory) => mount(factory))
        .catch((error: unknown) => {
          // Rendered annotation is progressive enhancement: a failed adapter chunk load
          // must not break the review surface or leak an unhandled rejection. Surface
          // it for diagnosis and leave the rail inert.
          console.error(
            "Failed to load the rendered annotation adapter",
            error,
          );
        });
    }

    return () => {
      cancelled = true;
      created?.destroy();
      setAnnotator(null);
    };
  }, [reviewText, annotatorFactory]);

  useEffect(() => {
    if (!annotator) {
      setPaintedIds(new Set());
      return;
    }
    setPaintedIds(new Set(annotator.setHighlights(highlights)));
  }, [annotator, highlights]);

  const submitDraft = (): void => {
    if (!draft) return;
    void onSubmitFeedback?.(
      buildRenderedTextAnchor({ path, selection: draft, body: draftBody }),
    );
    setDraft(null);
    setDraftBody("");
  };

  const activate = (id: string): void => {
    setActiveId(id);
    annotator?.activateHighlight(id);
  };

  return (
    <div className={wrapperClassName} data-annotation-path={path}>
      {hint}
      <div className="mirror-annotation__body">
        <RenderedSurface
          ref={containerRef}
          html={renderedHtml}
          className={surfaceClassName}
          safeCopy={safeCopy}
        />
        <aside className="mirror-comment-rail" aria-label="Rendered comments">
          {draft ? (
            <form
              className="mirror-comment-card mirror-comment-card--draft"
              data-annotation-draft
              onSubmit={(event) => {
                event.preventDefault();
                submitDraft();
              }}
            >
              <p className="mirror-comment-card__quote">{draft.quote}</p>
              <label>
                Feedback
                <textarea
                  name="body"
                  required
                  value={draftBody}
                  onChange={(event) => setDraftBody(event.target.value)}
                />
              </label>
              <div className="mirror-comment-card__actions">
                <button type="submit">Add comment</button>
                <button
                  type="button"
                  data-annotation-cancel
                  onClick={() => {
                    setDraft(null);
                    setDraftBody("");
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : null}
          {renderedComments.map((comment) => {
            // Navigation is offered only for a highlight actually painted, not merely
            // verified - a verified-but-unpainted comment presents like a drifted one.
            const painted = paintedIds.has(comment.id);
            return (
              <article
                key={comment.id}
                className="mirror-comment-card"
                data-annotation-comment-id={comment.id}
                data-annotation-painted={painted}
                data-active={comment.id === activeId || undefined}
              >
                <p className="mirror-comment-card__quote">{comment.quote}</p>
                <p className="mirror-comment-card__body">{comment.body}</p>
                {painted ? (
                  <button
                    type="button"
                    data-annotation-activate={comment.id}
                    onClick={() => activate(comment.id)}
                  >
                    Go to passage
                  </button>
                ) : (
                  <p className="mirror-comment-card__drifted">
                    Original passage drifted - no linked highlight.
                  </p>
                )}
              </article>
            );
          })}
        </aside>
      </div>
    </div>
  );
}
