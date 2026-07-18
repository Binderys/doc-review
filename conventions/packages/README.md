# Package Conventions

Packages are reusable workspace libraries. They should expose stable, intentional APIs to apps and other packages.

The packages that currently exist are inventoried in [`AGENTS.md`](../../AGENTS.md#workspace) (`## Workspace`); these conventions govern any package regardless of which exist.

## Responsibilities

- Keep package exports small and intentional.
- Export public APIs from `src/index.ts`.
- Avoid exporting framework-specific implementation details unless the package is explicitly framework-specific.
- Prefer TypeScript source as the package interface in this boilerplate.

## Shared Package

Use `packages/shared` for reusable code that is not owned by one app and is not specifically an API contract.

Good fits:

- constants used by multiple workspace projects,
- small pure utility functions,
- shared TypeScript types that are not transport contracts.

Avoid:

- React components,
- NestJS providers,
- database models,
- API request/response schemas.

## API Contracts Package

Use `packages/api-contracts` for types and schemas shared between client and server.

Good fits:

- request schemas,
- response schemas,
- DTO types,
- route-level contract types,
- validation schemas such as Zod schemas.

Avoid:

- server-only persistence entities,
- client-only view models,
- business logic with side effects,
- transport details that belong in network conventions.

## Dependency Rules

- Apps may depend on packages.
- Packages may depend on other packages only when the dependency direction is stable and deliberate.
- `packages/api-contracts` should stay independent from app frameworks.
- `packages/shared` should not import from apps.
- Avoid circular dependencies between packages.

## Source-Only Packages

Packages in this boilerplate may export TypeScript source directly while they are only consumed inside the monorepo. In that case, `build` may use `tsc --noEmit` to validate buildability without producing `dist` artifacts.

Switch to emitted package artifacts when a package needs to be published, consumed outside the monorepo, or loaded by tooling that cannot consume TypeScript source.

Placeholder package tests are acceptable only while a package has no meaningful logic, schemas, or behavior to test. Once a package owns non-trivial code, replace the placeholder with real tests.

## Verification

Before considering package changes complete, run:

- `pnpm typecheck`
- `pnpm test`
- app builds when a package API changes.

Placeholder package tests make the current test posture explicit. Replace them with real tests as soon as a package owns non-trivial logic, schemas, or behavior.
