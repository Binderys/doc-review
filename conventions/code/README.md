# Code Conventions

This repository uses TypeScript as the default language for frontend, backend, and shared package code. JavaScript is acceptable for tooling and configuration when TypeScript adds friction without improving safety.

## Tooling Policy

Use separate checks for code quality:

- `tsc`: validates TypeScript types.
- ESLint: catches risky code patterns and consistency issues.
- `typescript-eslint`: adds TypeScript parsing and TypeScript-specific rules to ESLint.
- Prettier: formats code layout.

Prettier owns formatting. ESLint owns code-quality rules. Avoid ESLint rules that only duplicate or fight with Prettier formatting.

## TypeScript Defaults

- Prefer TypeScript for application and package source files.
- Prefer explicit types at module boundaries: exported functions, API contracts, DTOs, public helpers, and shared package exports.
- Let TypeScript infer local variable types when the value is obvious.
- Avoid `any`. Use `unknown` when a value is genuinely untrusted, then narrow it before use.
- Keep shared request and response shapes in `packages/api-contracts` when they are used by both client and server.
- Keep generic cross-app helpers in `packages/shared`.

## JavaScript Usage

JavaScript is fine for:

- small config files,
- build/tooling scripts,
- compatibility files required by a framework or package.

Do not put application business logic in JavaScript unless there is a specific reason.

## Formatting

Use Prettier for formatting. Do not hand-format code to preserve custom alignment or spacing.

Default expectations:

- format before committing,
- keep generated files out of manual formatting decisions,
- do not mix unrelated formatting churn into feature changes.

## Naming

- Use `PascalCase` for React components, classes, and types that represent named concepts.
- Use `camelCase` for variables, functions, methods, and object properties.
- Use `UPPER_SNAKE_CASE` for process-level constants and environment variable names.
- Use descriptive names over abbreviations, except for common domain terms.
- Name files after the main thing they export when there is a clear primary export.

## Imports and Exports

- Prefer named exports for shared utilities and types.
- Keep imports grouped by external packages, workspace packages, and local files.
- Avoid deep imports across package boundaries unless the package explicitly exposes that path.
- Do not create circular dependencies between apps or packages.

## Error Handling

- Validate external inputs at the boundary: API requests, environment variables, network responses, and persisted data.
- Prefer explicit error paths over silent fallbacks.
- Preserve useful debugging context when wrapping or rethrowing errors.
- Do not expose sensitive internals in client-facing errors.

## Testing Expectations

- Add focused tests for shared utilities, API contracts, and non-trivial business logic.
- Prefer integration-style tests for behavior that crosses module boundaries.
- Keep tests deterministic: avoid real network calls, wall-clock assumptions, or shared mutable state.
