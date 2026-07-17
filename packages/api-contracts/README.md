# @doc-review/api-contracts

Shared API schemas, DTOs, and contract types. Requests are validated with zod
schemas; response shapes are TypeScript types covered by typecheck.

## zod schemas vs. the server's class-validator DTOs

The zod schemas here and the server's `class-validator` DTOs validate the same
endpoints with the same rules, on purpose:

- This package stays framework-neutral so any consumer (client, server, a future
  service) can import it without pulling in Nest.
- The server keeps its Nest-idiomatic `class-validator` DTOs for request
  validation at the controller boundary.

The two sets of rules are kept in sync by hand. If you want the contract enforced
end-to-end from a single source of truth, [ts-rest](https://ts-rest.com) or
[tRPC](https://trpc.io) are the upgrade path.
