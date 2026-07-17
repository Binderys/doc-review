# App Conventions

Apps are deployable workspace projects. They compose packages, framework code, configuration, and runtime behavior into a product surface.

Current apps:

- `apps/client`: React and Vite frontend.
- `apps/server`: NestJS API server.

## Responsibilities

- Keep app-specific UI, routes, controllers, modules, configuration, and runtime wiring inside the app that owns them.
- Import shared domain-neutral utilities from `packages/shared`.
- Import shared API schemas and DTOs from `packages/api-contracts`.
- Do not put reusable workspace code directly inside an app if another app or package will need it.

## Client App

- Use React components for UI composition and keep browser-only behavior inside `apps/client`.
- Keep page-level routing and feature composition in the client app.
- Treat API response shapes as shared contracts, not locally invented types.
- Keep environment-specific frontend configuration close to the Vite app.
- The scaffold client is deliberately minimal and imposes no folder architecture. For a larger client, Feature-Sliced Design is the proven, recommended structure - optional, not mandated.

## Server App

- Use NestJS modules to group backend capabilities.
- Keep controllers thin: validate input, call application services, and return contract-shaped responses.
- Keep infrastructure wiring, database configuration, and authentication setup inside the server app unless another deployable app needs it.
- Do not leak persistence models directly into API contracts.

## Boundaries

- Apps may depend on packages.
- Packages must not depend on apps.
- Client and server should communicate through API contracts, not copied types.
- App-local code can be pragmatic; shared package code should be more stable and deliberate.

## Testing

- Default app tests should run without Docker, a persistent database, or external network services.
- SQL integration and e2e tests should prefer disposable Postgres through Testcontainers when the environment exposes a Docker-compatible runtime.
- Agents running inside containers should treat Testcontainers as optional unless the host Docker socket is explicitly available.
- Permanent local databases are useful for manual development, but automated tests should not assume shared database state.

## Verification

Before considering app changes complete, run the relevant app checks:

- `pnpm --filter @doc-review/client typecheck`
- `pnpm --filter @doc-review/client build`
- `pnpm --filter @doc-review/server typecheck`
- `pnpm --filter @doc-review/server test`
- `pnpm --filter @doc-review/server build`
