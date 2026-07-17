# Doc Review

Review the document PRs your agents produce. Doc Review renders pull requests whose
payload is documents - md, html, pdf, docx - and gives them a real review surface:
readable diffs, anchored feedback, and explicit review rounds, self-hosted so private
documents never leave your network.

## Why

GitHub's PR view is built for code. Agents doing non-coding work increasingly deliver
documents through the same PR loop, and those payloads get no readable diff, no inline
commenting, no review state. Doc Review exists so a document PR can be reviewed as
deliberately as a code PR.

## Status

In progress, spec-first: the repo opens with its decisions, and the code follows in
public. Doc Review re-founds a design begun in my personal projects - picked up
mid-flight, which is why the public version line opens at **0.3.0** rather than 0.1.0.
Tags land as the build does.

## How this repo works

- Specs and PRDs live in the [issue tracker](https://github.com/Binderys/doc-review/issues);
  architecture decisions in [docs/adr/](docs/adr/).
- Reference documentation will be mostly generated (OpenWiki) once there is code worth
  documenting; generated docs are tool-owned and never hand-edited.
