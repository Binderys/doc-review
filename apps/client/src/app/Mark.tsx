// The canonical seam mark (binderys DESIGN "The seam"): three sewing stations with the
// thread changing sides between them. Monochrome everywhere but the favicon, so here it
// inherits `currentColor` and never wears the signature. The lateral offset is the mark;
// the alignment is not "fixed".
export function Mark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={3.5}
      strokeLinecap="round"
    >
      <path d="M10.25 1.9v2.75M13.75 10.65v2.75M10.25 19.4v2.75" />
    </svg>
  );
}
