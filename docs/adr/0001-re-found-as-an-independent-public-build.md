# 0001 - Re-found document-PR review as an independent public build

Status: accepted (2026-07-17), amended by [ADR 0002](./0002-port-the-predecessor-working-tree.md)

## Context

A working design for reviewing document PRs - pull requests whose payload is documents
produced by agents doing non-coding work - already exists in my personal projects,
private and mid-flight. It cannot simply be opened: its history, tracker, and docs are
threaded with private context (other tools, private infrastructure) that a public repo
should not carry.

## Decision

Open `Binderys/doc-review` as a fresh, independent public build.

- **Fresh history.** Nothing is ported - no code, commits, issues, or ADR text. The
  design knowledge carries; the artifacts do not.
- **Independent version line, opening at 0.3.0.** The number states the design's
  maturity honestly: there was a 0.1 and a 0.2, on the private side. This line is
  never synced to the private one; tags land as the public build does.
- **Provenance stays at one altitude.** "Begun in my personal projects" is the whole
  public record - no repo names, no accounts.
- **Public process.** Specs and PRDs as issues, decisions as ADRs - this file starts
  the line at 0001, and the numbering has no hidden prefix. Everything is authored
  fresh in this repo.

## Consequences

- The stack is deliberately undecided here; the next ADRs own it as code lands.
- The public tracker is the only tracker - there is no shadow process.
- Anything not expressible without private context stays out of this repo.
