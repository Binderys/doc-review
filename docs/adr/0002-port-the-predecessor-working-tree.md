# 0002 - Port the predecessor's working tree; its history stays private

Status: accepted (2026-07-17); amends [ADR 0001](./0001-re-found-as-an-independent-public-build.md)

## Context

ADR 0001 opened this repo fresh: no code, commits, issues, or ADR text ported. Within
the day, that clause proved to cost more than it bought. The predecessor private build
is not a sketch - it is a working full-stack implementation (client, server, shared
contracts, an agent-operating harness) whose re-authoring in public would be months of
ceremony reproducing decisions already made and tested. The thing ADR 0001 actually
protects - private context in the history, tracker, and infrastructure references -
does not require re-typing the code; it requires keeping the private _artifacts_
private and scrubbing the _tree_.

## Decision

Amend ADR 0001's fresh-history clause, and only that clause:

- **The working tree is ported** as fresh commits authored in this repo, after a
  hygiene pass that removes private infrastructure references, private tracker
  references, and identity material. The port lands as the tree stood at the
  predecessor's final state; from then on all work is native to this repo.
- **The predecessor's ADRs are ported as records**, renumbered into this repo's
  namespace (0003 onward, original order) with a provenance line each. Decisions
  carry; their private context is rewritten to this repo's altitude.
- **Commits, issues, and tracker history are NOT ported.** The predecessor's history
  remains in its private, archived repo. This repo's history begins at ADR 0001's
  commit.
- **ADR 0001's altitude clause is unchanged**: "begun in my personal projects" remains
  the whole public record - no repo names, no accounts.

## Consequences

- The ported tree is MIT-licensed by landing here; the predecessor code was previously
  unlicensed private work by the same owner.
- The public version line continues at 0.3.0 as ADR 0001 set it; the port is the
  0.3.0 line's opening state, not a version event.
- The port commit is the one place "predecessor" is load-bearing: everything after it
  must be reviewable without any private-side knowledge.
- Anything in the ported tree still not expressible without private context was
  rewritten or removed in the hygiene pass; finding a missed case is a bug in this
  repo, fixed here.
