---
status: superseded by ADR 0005
---

# Crit owns the review loop

> Ported from the predecessor private build's ADR 0012 (2026-07-17); see
> [ADR 0002](./0002-port-the-predecessor-working-tree.md). The trial and synthesis
> records cited below live in the predecessor's tracker (private).

Crit was selected to replace the standalone predecessor review application because it
appeared to provide remote pull-request reads, a browser review surface, structured
feedback, agent handoff, and iterative review rounds. The decision was to use Crit
unchanged, route generic gaps upstream, keep only operator-specific glue here, and
permit a temporary fork only while a concrete upstream patch was pending or rejected.

The real Crit trials and their synthesis (predecessor tracker, private) showed that
Crit did not provide usable rendered HTML or DOCX review and that its approval
lifecycle did not match merge-scoped working state. The subsequent Orca evaluation was
also closed without adoption because orchestration already lives elsewhere in the
operator's tooling and a full agent development environment was over-scoped for the
remaining document-review need. [ADR 0005](./0005-local-feedback-with-read-only-github.md)
therefore supersedes this decision: Doc Review owns the document-only loop, while Crit
and Orca are not runtime components.

Closing adoption does not close upstream contribution. Generic DOCX/PDF viewer support
may still be proposed or contributed to Orca independently; doing so neither makes Orca
a Doc Review dependency nor reopens adoption without a new evaluation and decision.
[ADR 0003](./0003-self-hosted-web-dashboard.md)'s self-hosted, no-third-party-content
foundation remains active.
