---
status: accepted
---

# Document review feedback stays local while GitHub review state remains untouched

> Ported from the predecessor private build's ADR 0011 (2026-07-17); see
> [ADR 0002](./0002-port-the-predecessor-working-tree.md).

Doc Review owns the document-only review loop on the self-hosted review surface
established by [ADR 0003](./0003-self-hosted-web-dashboard.md). Each exact pull-request
head owns a durable local review round whose structured feedback uses
document-appropriate anchors: Mirror line ranges, Canonical section-and-quote locators,
HTML source lines, file anchors, or a review-level anchor. Only unresolved feedback
carries to a new head, and Doc Review marks an anchor drifted whenever it cannot
conservatively reattach it.

Finishing a round exposes endpoint-primary structured JSON for the dispatched review
agent; an on-disk snapshot is optional, and the agent's response is the next branch
head rather than a write-back channel. Only the reviewer resolves feedback, approval
requires no unresolved feedback, and the local state is working state deleted when a
later request observes that the pull request has merged.

## Consequences

- Doc Review does not post GitHub comments, reviews, resolutions, approvals, or
  merges. Ordinary branch pushes and merges remain external build-plane or operator
  actions.
- Code review, agent orchestration, rendered DOCX/PDF line anchoring, and Word layout
  fidelity remain outside this loop.
- Route mechanics remain owned by the server controllers, following
  [ADR 0004](./0004-authoritative-scaffold-facts.md); this record owns the
  architectural boundary rather than an endpoint inventory.
