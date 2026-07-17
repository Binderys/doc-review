# API Conventions

How the HTTP API between `apps/client` and `apps/server` is shaped, and how its
contracts live in `packages/api-contracts`. Builds on
[`conventions/code/README.md`](../code/README.md).

_Source: genericized from proven conventions in sibling private builds._

> **Scaffold status:** the v1 server's capability posture is owned by
> [ADR 0003](../../docs/adr/0003-self-hosted-web-dashboard.md) (referenced not restated, per
> [ADR 0004](../../docs/adr/0004-authoritative-scaffold-facts.md)); under that posture, the
> server-side request-validation practice described below has no live example yet. On the
> client, the shared request helper in `apps/client/src/shared/api/apiClient.ts` already
> parses every response against its `@doc-review/api-contracts` schema at the boundary - an
> invalid response is surfaced as an error, never silently trusted. Treat Contracts as the
> target discipline (proven in skhlio); the server's review-surface routes adopt it as they
> land.

## Contracts

- Keep shared request and response shapes in `@doc-review/api-contracts`, defined as Zod
  schemas; both apps import them. Apps do not invent local types for wire shapes.
- Export the schema and infer its type (`z.infer`) from the same place, so the type and
  the runtime validator never drift.
- Validate at the boundary: the server validates each incoming request against its
  contract before handling it; the client parses each response against the contract
  before use.
- Contracts describe the wire shape only - never persistence entities or raw upstream
  payloads. Keep server-only fields (e.g. stored raw JSON) out of the contract and
  expose only typed fields.

## REST style

- Resource-oriented, plural nouns: `/users`, `/users/:id`.
- Methods carry the verb: `GET` (read), `POST` (create), `PATCH` (partial update),
  `DELETE`.
- Actions and sub-resources are nested paths: `POST /users/:id/sessions`.
- IDs in paths are the surrogate key (e.g. UUID), not a mutable business key.

## Controllers

- Keep controllers thin: validate input, call an application service, return a
  contract-shaped response. No business logic in controllers.
- Map service and domain results to the contract shape explicitly; do not return
  TypeORM entities directly.

## Errors

- Use a consistent error body via the global exception filter
  (`common/filters/http-exception.filter.ts`); never return internal details or stack
  traces to the client.
- Use standard status codes: `400` (validation), `401`/`403` (auth), `404` (not found),
  `409` (conflict, e.g. a uniqueness clash), and an upstream-failure code (e.g. `502`)
  when an external source fails.

## Versioning

- Unversioned while the API has a single, private consumer. Revisit if an external or
  third-party consumer ever appears.
