# Doc Review

Review the document PRs your agents produce. Doc Review renders pull requests whose
payload is documents - md, html, pdf, docx - and gives them a real review surface:
readable diffs, anchored feedback, and explicit review rounds, self-hosted so private
documents never leave your network.

## Why

GitHub's PR view is built for code. Agents doing non-coding work increasingly deliver
documents through the same PR loop, and those payloads get no readable diff, no inline
commenting, no review state. Doc Review exists so a document PR can be reviewed as
deliberately as a code PR.

## Status

In progress. The repo opened spec-first; the predecessor build's working tree has since
landed as this line's 0.3.0 opening state (see
[ADR 0002](docs/adr/0002-port-the-predecessor-working-tree.md)) - which is also why the
public version line opens at **0.3.0** rather than 0.1.0: there was a 0.1 and a 0.2 on
the private side. Tags land as the build does.

## Development

A pnpm + Turbo monorepo (Node and pnpm floors are declared in the root `package.json`):

- `apps/client` - React + Vite review surface.
- `apps/server` - NestJS API: PR reads, document rendering, review-round state.
- `packages/shared` - shared constants, utils, types.
- `packages/api-contracts` - API schemas, DTOs, contract types.

```bash
pnpm install
pnpm dev            # all workspaces
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Deployment

The [Binderys-mini deployment and rollback handoff](docs/deployment.md) owns the
operator procedure: green-SHA local builds, the persistent Compose volume, Tailscale
HTTPS exposure, verification, rollback, and approval-gated cold-reboot testing.

The operator `.env` is excluded from both Git and the deny-by-default Docker build
context. Back it up only if the operator deliberately adopts a backup policy; Doc
Review does not provide backup or restore behavior.

## How this repo works

- Specs and PRDs live in the [issue tracker](https://github.com/Binderys/doc-review/issues);
  architecture decisions in [docs/adr/](docs/adr/).
- Reference documentation will be mostly generated (OpenWiki) once there is code worth
  documenting; generated docs are tool-owned and never hand-edited.
