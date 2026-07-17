# doc-review

An always-on, self-hosted dashboard for reviewing document PRs - pull requests whose
payload is documents (md, html, pdf, docx), produced by agents doing non-coding work.
It exists because GitHub's PR view cannot render those documents and the review machine
has no Office.

## Language

**Document PR**:
A pull request whose payload is documents rather than code; the unit this tool reviews.
_Avoid_: code review, code PR

**Canonical** (정본):
The docx deliverable that is actually sent to outside parties. A generated build
artifact, never hand-edited.
_Avoid_: original, final

**Mirror**:
The md twin of a canonical, kept in the same PR as the content source of truth and the
thing diffs run against.
_Avoid_: copy, duplicate

**Review surface**:
The per-PR page the dashboard serves: metadata, and each changed file rendered and/or
diffed according to its format.
_Avoid_: preview, viewer

**Watched repo**:
A repo named in the server's configuration; only watched repos appear on the dashboard.
_Avoid_: tracked, registered

**Rendering**:
Converting a changed file into browser-displayable form, always on the server itself -
confidential content never leaves the network you run the server on.
_Avoid_: preview generation, export

## Scaffold provenance

- **Scaffolded from:** a private full-stack TypeScript boilerplate, at its v0.6.0 tag
  (2026-07-12), via the predecessor private build whose working tree was ported here on
  2026-07-17 - see
  [ADR 0002](docs/adr/0002-port-the-predecessor-working-tree.md). The predecessor's
  commit history and tracker are not part of this repo's record.
- **Reconciled through:** v0.6.0 - the upstream tag whose delta was last reviewed as
  owed-work. The `upkeep` skill's upstream-delta leg resolves its baseline from this
  line; each reviewed delta proposes pinning it forward as ordinary follow-up
  (report-only, never writing the pin itself).
