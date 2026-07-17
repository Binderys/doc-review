# Network Conventions

How the client and server communicate over the wire, and how the server calls the
external services it depends on. Builds on
[`conventions/code/README.md`](../code/README.md) and
[`conventions/api/README.md`](../api/README.md).

_Source: the resilient outbound-transport and client/server transport practices are
genericized from proven sibling private builds._

## Client to server transport

- JSON over HTTP. The client reaches the server only through the documented API - never
  a database, and never an external service directly.
- The server owns all outbound calls to external services. Secrets (JWT signing keys,
  DB credentials, third-party API keys) are read through `ConfigService` and stay
  server-side; they are never shipped to the browser.
- Route server calls through a single API client module in `apps/client/src/shared`
  rather than ad-hoc `fetch` scattered through components. That module wraps `fetch`
  with the base URL, response parsing against `@doc-review/api-contracts` schemas, and error
  normalization; feature- and entity-level hooks build on it. The base URL comes from
  Vite env (`import.meta.env`), never hardcoded. (A proven sibling build uses TanStack
  Query on top of this module to own retry, loading, and error state.)

## CORS & headers

- The server enables CORS for the known client origin(s), not `*`, once it leaves
  localhost. The scaffold ships `origin: true` with credentials for localhost
  development; tighten it to known origins when auth lands or the app is deployed.

## Outbound transport to external services

When the server wraps an external API, model that upstream as a typed client that owns
its own transport; callers never issue raw `fetch` against the upstream.

- Retry only classified-retryable failures - rate-limit, quota, timeout, and `5xx` -
  using capped exponential backoff with jitter and a ceiling on both attempts and delay.
  Terminal failures throw a typed error immediately rather than being retried.
- Inject the transport seams (`fetch`, a `sleep`, and any clock or randomness) so the
  client is testable deterministically - no real network calls and no wall-clock
  assumptions in tests.
- Model auth as a token provider: cache the token, reissue proactively inside an expiry
  buffer, coalesce concurrent reissues into one in-flight request, and on an
  authentication failure invalidate the cached token and retry once.
- Surface failures as typed errors that carry the upstream status and error code (plus
  any trace or rate-limit metadata the gateway returns). Parse error bodies defensively
  and narrow `unknown` with type guards; never reach for `any`.

## Failure handling

- Transport errors surface as typed errors from the API client. On the client, the
  data-fetching layer owns retry, loading, and error states.
- Upstream failures map to API error responses per the
  [API conventions](../api/README.md), not raw passthrough to the client.
