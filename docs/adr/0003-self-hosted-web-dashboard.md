# 0003 - Doc Review is a persistent self-hosted web dashboard, not a terminal tool

> Ported from the predecessor private build's ADR 0001 (2026-07-17); see
> [ADR 0002](./0002-port-the-predecessor-working-tree.md).

Doc Review began as a thin `gh` wrapper paging PR diffs through `less`, but its real job
is reviewing document PRs (docx/html/pdf payloads from agent work in non-coding repos),
which a terminal cannot render. Native desktop rendering was rejected because the review
machines have no Office - the docx canonicals are themselves generated artifacts. We
chose a persistent Node server, self-hosted on the operator's own infrastructure:
always-on fits the review cadence (dozens of agent PRs per week), and the operator's
private network is the trust boundary for confidential content, so all rendering
happens on the server and the process binds to loopback by default - exposure beyond
the host is a deliberate operator action, never a public address.

## Consequences

- The host needs an authenticated `gh` with read scope; v1 is read-only, so no write
  scopes until a merge/approve feature deliberately adds them.
- The original bash wrapper is superseded by this shape.
