# Guardrails

> Status: v1. The universal rules below are backed today by CI (the required `Quality gate` check) and `.gitignore`; the remaining pre-commit tooling is still planned (see Enforcement). Precedence: an explicit instruction from the user overrides these; otherwise treat them as binding.

Hard rules for agents working in this repository: the "never" and "ask first" boundaries that stop destructive or low-quality changes. Read alongside the root `AGENTS.md` (commands, conventions, boundaries) and the `conventions/` folder.

## Profiles

This boilerplate serves more than one project shape (full-stack TypeScript, packages-only TypeScript, and a planned python-data variant; see the variants roadmap). Rules are grouped so profile-specific ones stay scoped:

- **Universal** rules hold on every profile - secrets, git safety, generated files, and never weakening a test are unconditional.
- **TypeScript profiles** (full-stack and packages-only) share the pnpm/ESLint/Prettier toolchain rules.
- **Full-stack TypeScript profile only** adds the Nest `ConfigService` and TypeORM/Postgres rules; a packages-only repo has neither.
- A **python-data** profile (uv/ruff/pytest) will get its own scoped section as a later item; its rules are intentionally not authored here yet.

## Universal (every profile)

### Secrets

- Never commit real secrets. `.env*` is gitignored; keep `.env.example` placeholder-only (e.g. `JWT_SECRET=replace-me`).
- Never print, log, or hardcode secrets or connection strings in source. Read them from the environment.

### Git safety

- Never `git push --force`, `git reset --hard`, or `git clean -fdx` without explicit confirmation.
- Never commit directly to `main`; branch `feat/`, `fix/`, `chore/`. `main` is protected (PR-only, required `Quality gate`, no direct push).
- Never skip hooks with `--no-verify`. Never rewrite already-pushed history.

### Generated files & dependencies

- Never hand-edit generated files; regenerate them via the owning command. For the TypeScript profiles that means `pnpm-lock.yaml`, `dist/`, `coverage/`, and `*.tsbuildinfo`.
- Change dependencies only through the package manager, never by hand-editing a lockfile. On the TypeScript profiles use `pnpm add` / `pnpm remove` (never npm or yarn). Ask before adding a dependency.

### Tests

- Never delete, `.skip` / `xit`, or weaken a failing test to go green. Fix it or flag it.
- Never finish a task with a failing gate (see Enforcement).

## TypeScript profiles (full-stack and packages-only)

### Code quality

- Never use `any` to silence the type checker; use `unknown`, then narrow.
- Never inline-disable ESLint (`// eslint-disable`) to make a check pass; fix the cause.
- Never hand-format to fight Prettier; run `pnpm format`.
- Finish with `pnpm typecheck`, `pnpm lint`, and `pnpm test` all green.

## Full-stack TypeScript profile only

### Config access

- Read config through the Nest `ConfigService` (Joi-validated). Never hardcode secrets or connection strings in source.

### Database (TypeORM + Postgres)

- Never set `synchronize: true` against a real database; it can drop columns and data. Use migrations.
- Entities and migrations are review-required. Never run migrations against production without approval.

## Verification tiers

The required `Quality gate` runs on everything; no tier skips it. The attention-costly rituals are rationed by **blast radius**. Classify by what the change is _to_, not which file it lives in (nearly every file ships with the template - only some of them turn a wrong word into wrong behavior):

| Change class                                                                                                                                                                   | Earns                                                                               | Skips                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Instructions agents obey** - skills, prompts, this file, `conventions/`, CI workflow contracts, setup/variant recipes. A wrong word silently changes behavior in every fork. | Cross-model adversarial review + fresh-eyes verification + the gate                 | Nothing                                                                   |
| **Scaffold code forks run** - `apps/`, `packages/`. Defects propagate, but every fork's own gate re-tests them.                                                                | Fresh-eyes verification against the change's written acceptance criteria + the gate | Cross-model review (add it back when the change touches auth or security) |
| **Descriptive text** - docs wording, registry ledger lines, release version bumps, status notes. Defects are visible and locally correctable; the drift audit sweeps them.     | The Quality gate                                                                    | Adversarial review, fresh-eyes passes, ledger ceremony                    |

Edge rules:

- An edit that cannot change what an agent does (a typo, a dead link, formatting) counts as descriptive even inside an instruction file. When in doubt, treat the change as instruction-bearing.
- When a change matches more than one row, the highest matching row wins (a version edit inside a CI workflow contract is an instruction change, not a version bump).
- A scaffold-code change that arrives without written acceptance criteria gets them written into its issue or PR body before landing - fresh-eyes verification needs a claim to falsify; absent criteria it is inconclusive, not skipped.

The rituals, as used above:

- **Cross-model adversarial review** - a fresh-thread reviewer that tries to refute the change and is never drawn from the model family that wrote it; the discipline applies to any instruction-surface PR.
- **Fresh-eyes verification** - a fresh-context reviewer checks the landed result against its written acceptance criteria, with no memory of how it was built.
- **Ledger ceremony** - a closing comment on the driving issue that records what landed, what was verified, and what remains.

## Enforcement

These rules are backed by a mix of live tooling and still-manual discipline.

**Live today.** On a protected `main` (see `docs/agents/repo-setup.md`), the required `Quality gate` check is the deterministic backstop for the universal and TypeScript-profile rules. It fans out to three CI workers (`.github/workflows/ci.yml`):

- **verify** - `pnpm format:check`, `pnpm lint` (flags `any` and unused vars), `pnpm typecheck`, `pnpm test`, `pnpm build`.
- **e2e** - the server boot smoke (`pnpm test:e2e`); its shape is owned by [`apps/server/test/app.e2e-spec.ts`](../../apps/server/test/app.e2e-spec.ts) per [ADR 0004](../../docs/adr/0004-authoritative-scaffold-facts.md).
- **audit** - a gitleaks scan over the PR's commit range (`origin/main..HEAD`), so a secret added then deleted within the same PR is still caught.

`.gitignore` also blocks `.env*` from being committed at all.

**Still manual (planned).** These rules rely on the agent reading this file until backed by tooling:

- Pre-commit: husky + lint-staged (Prettier + ESLint + typecheck on staged files), to catch violations before CI.
- Dangerous-command blocking: Claude Code hooks for `rm -rf`, force-push, `reset --hard`, `--no-verify`.

**Proven downstream, adoption planned.** The enforced read-only reviewer role, proven in the `cc-vs-pi-vs-vibe` proving ground and mirrored here as a pattern (ADR 0004):

- A review or verification session gets its read-only-ness **enforced per-session, fail-closed** - a deny layer over the shell blocks `git push` / `commit` / `merge`, branch and tag deletion, `gh issue|pr create|edit|close|review`, and `gh api` writes (`-X POST|PATCH|PUT|DELETE`, or field-carrying calls without an explicit GET); `gh ... comment` sits behind an operator confirm instead of a deny.
- Hardened against evasion, not just the happy path: quoted flag values cannot slip past the denies, `gh` denies match flags placed before subcommands, and benign redirects that merely name a protected path are not treated as write intent.
- Scoped to the session, not the project: the landing role keeps its push rights; project-global rules stay untouched.

Today read-only review sessions in this repo rely on prompt discipline alone. Adopting the pattern means binding such a deny layer to review sessions - the same mechanism as the dangerous-command blocking above. The pattern was proven in a sibling private build (reviewer deny rules layered over a damage-control base, hardened across several rounds, exercised in observed review runs).

## Source

Promoted from a v0 draft and mirrored from a sibling private build's guardrails. Build-specific detail is genericized here.
