# @doc-review/api-contracts

The framework-neutral home of the shared wire contracts both apps import: request
and response shapes defined as Zod schemas alongside the types inferred from them,
so any consumer (client, server, or a future service) can depend on the contract
without pulling in a framework.

How each boundary validates a request or response against these contracts is owned
by [`conventions/api`](../../conventions/api/README.md) and the app code that
applies it; it is not restated here.
