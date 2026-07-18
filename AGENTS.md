# Agent Harness

Operating instructions for coding agents working in this repository.
This is a full-stack TypeScript monorepo (pnpm workspace + Turbo). Authoritative rules live in `conventions/`; read the relevant convention before changing that area. Hard rules live in `agent-preference/guardrails/`.

## Workspace

- `apps/client` - React 19 + Vite frontend (`@doc-review/client`).
- `apps/server` - NestJS 11 API (`@doc-review/server`): config, common, health.
- `packages/shared` - shared constants, utils, types (`@doc-review/shared`).
- `packages/api-contracts` - shared API schemas, DTOs, contract types (`@doc-review/api-contracts`).

The pinned Node and pnpm versions are owned by the root [`package.json`](package.json) (`engines` / `packageManager`). Use pnpm only; never npm or yarn.

## Commands

Run from the repo root; Turbo fans out across the workspaces.

- Install: `pnpm install`
- Dev (all): `pnpm dev`
- Dev (one app): `pnpm --filter @doc-review/server dev` (or `@doc-review/client`)
- Build: `pnpm build`
- Typecheck: `pnpm typecheck`
- Lint: `pnpm lint`
- Format: `pnpm format` (Prettier; verify with `pnpm format:check`)
- Test (all): `pnpm test`
- Test (one pkg): `pnpm --filter @doc-review/server test`
- Single test: `pnpm --filter @doc-review/server test -- -t "<test name>"` (server uses Jest)

The server tests on Jest (unit specs via `pnpm test`, plus a boot smoke via `pnpm test:e2e`, owned by [`apps/server/test/app.e2e-spec.ts`](apps/server/test/app.e2e-spec.ts) per [ADR 0004](docs/adr/0004-authoritative-scaffold-facts.md)); the client tests on Vitest (`renderToStaticMarkup`). Before marking work done, `pnpm typecheck`, `pnpm lint`, and `pnpm test` must pass.

## Conventions

Read the matching file under `conventions/` before editing that surface:

- `conventions/code` - TypeScript-first; avoid `any` (use `unknown`, then narrow); explicit types at module boundaries; Prettier owns formatting, ESLint owns code-quality.
- `conventions/apps` - client and server app structure.
- `conventions/packages` - shared package structure.
- `conventions/api` - API design and contracts.
- `conventions/network` - network and transport practices.

Placement: shared request/response shapes go in `@doc-review/api-contracts`; generic cross-app helpers go in `@doc-review/shared`. Do not duplicate either into an app.

## Boundaries

- Always: read files, run typecheck/lint/test, single-file edits within a workspace.
- Ask first: adding dependencies, changing `pnpm-workspace.yaml` / `turbo.json` / tsconfig, DB entities or migrations, `git push`.
- Never: commit secrets (use `.env`; see `.env.example`); hand-edit `pnpm-lock.yaml` or other generated files; hand-format to fight Prettier; use `any` to silence the type checker.

## GitHub tooling

- Use the `gh` CLI by default for GitHub reads and writes; do not use the GitHub MCP connector unless the user explicitly requests it or `gh` cannot perform the required operation.
- Before any GitHub write or `git push`, verify that `gh` is authenticated as the account you intend to write as.

## Agent skills

The `docs/agents/` config below (issue tracker, triage labels, domain docs) is
generated and consumed by [Matt Pocock's skills](https://github.com/mattpocock/skills/tree/d574778f94cf620fcc8ce741584093bc650a61d3),
pinned at commit `d574778` (the v1.1.0 release: `to-prd` → `to-spec`, `to-plan` +
`to-issues` → `to-tickets`, `review` → `code-review`). The skills themselves are
not vendored in this repo; install them per machine:

```bash
pnpm dlx skills@latest add mattpocock/skills
```

Select `setup-matt-pocock-skills` (plus `code-review`, the `to-spec`/`to-tickets`
planning pair, and any others you want) at the prompt. Then run
`/setup-matt-pocock-skills` once to (re)generate this config so the issue tracker,
labels, and domain layout point at `Binderys/doc-review`.

### Issue tracker

Issues and PRDs live as GitHub issues in `Binderys/doc-review`, via the `gh` CLI.
External PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles mapped to their default label strings
(`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`).
See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root.
See `docs/agents/domain.md`.

### Repository settings (branch protection, auto-merge)

`main` is governed by a GitHub ruleset + repo flags (PR-only, required `Quality gate`
check, linear history, no force-push/delete, no bypass; plus auto-merge and
auto-delete-branch). These are repo-level settings, not files; the `Quality gate` name
is load-bearing - the ruleset's required check context must match the CI job name
verbatim, so never rename one without the other.
