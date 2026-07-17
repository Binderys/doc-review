# 0004 - Each scaffold fact has one authoritative owner; instruction surfaces reference it, not restate it

> Ported from the predecessor private build's ADR 0002 (2026-07-17); see
> [ADR 0002](./0002-port-the-predecessor-working-tree.md). Predecessor tracker
> references below are historical and private.

The v1 auth/users/db subtraction (predecessor tracker) moved the tree, but several
instruction surfaces still described the removed scaffold: the server module inventory,
the `test:e2e` shape, the read-only invariant, and the route surface were each restated
across `AGENTS.md`, `agent-preference/guardrails/`, and code comments. That is a duplication / shotgun-surgery smell: a single scaffold change has to
be hand-propagated to every restatement, and the `drift-audit` skill only catches the
divergence _after_ it lands. We give each cross-cited scaffold fact a single
authoritative owner to prevent the class before it lands: the fact lives at exactly one
altitude in one owning surface, and secondary surfaces **reference** the owner rather
than restate it, so one change updates one place and dependents cannot silently go
stale.

Owners, at each fact's natural altitude:

- **Server module inventory** - `AGENTS.md` `## Workspace` (the harness's structural map).
- **`test:e2e` shape** - `apps/server/test/app.e2e-spec.ts`; `.github/workflows/ci.yml`
  runs it and the docs reference it.
- **Read-only invariant** - [ADR 0003](./0003-self-hosted-web-dashboard.md).
- **Route surface** (which endpoints exist) - the server controllers under
  `apps/server/src/modules/`; no other surface enumerates the routes.

A secondary surface may state a fact's _purpose_ at its own altitude (e.g. guardrails
explaining why the gate exists), but must not be an independent source of the
_mechanism_; where it needs the mechanical detail it links to the owner. This is the
general rule, not a one-off cleanup: it governs how new instruction surfaces compose
from here on.

## Consequences

- A scaffold change updates only its owning surface; referencing surfaces cannot drift
  on that change. The restatement drift class is prevented at authoring time, not
  caught afterward by `drift-audit`, whose job narrows to checking that references
  resolve and the owner is accurate.
- This ADR records the decision only; collapsing the existing restatements to
  references, surface by surface, was implemented in the predecessor and carried in
  the ported tree.
- The root cause is inherited from the upstream private boilerplate (the restatements
  came down at scaffold), so the same smell existed upstream; it was surfaced there
  and landed as that repo's own decision record.
- This ADR is itself an "Instructions agents obey" surface, so changes to it and the
  other instruction surfaces follow the verification tier owned by
  [`agent-preference/guardrails/README.md`](../../agent-preference/guardrails/README.md)
  (`## Verification tiers`), not any mechanism restated here.
