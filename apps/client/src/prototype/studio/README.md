# Studio prototype (throwaway)

**Disposable user-facing UI prototype, not production code.** It never ships:
`studio.html` is not a `vite build` input, and the prototype loads no production styles.

## The question

The two prior prototypes (No. 1 Ledger, No. 2 editorial shell A/B/C) both study the
per-PR _review surface chrome_ in isolation. This one answers the next question: what
does the **whole user journey** feel like - the dashboard of watched repos and their
document PRs flowing into a polished review surface - as one coherent application
wearing the binderys editorial identity?

## What it is

A single self-contained app (`StudioApp.tsx`) with two views and internal navigation:

- **Dashboard** - watched repos grouped under their GitHub resource owners, each with a
  card per document PR: review state (label + non-colour glyph), a format strip
  (Mirror / Canonical / HTML / PDF), branch, author, round, age. Unavailable watched
  repos stay listed without blocking the available ones.
- **Review surface** - masthead crumb, a folio-numbered document index, a constant
  reading pane with an inline change ribbon (ins/del by weight and rule, not colour),
  and a sticky feedback ledger (the Binding) carrying round state, drift flags, and the
  approve / request-changes actions.

## What it reuses from the canonical identity

Lifted verbatim from `/Users/skhl/bootstrap/binderys/DESIGN.md`:

- The two verified grounds (`paper` / `ink`) and derived neutrals, with a persistent
  Paper/Ink control wearing the muted role, never the signature (theme is state).
- The seam mark and `binderys` lockup, plus the sibling identity `folio 01 - Doc Review`.
- The signature (oxblood) trio for identity moments only (PR/folio numbers, links, the
  primary action inverts to accent border + accent text); the waxed-thread pair for
  structure only (Binding rules, ribbon spine).
- The phi spacing scale (computed, not rounded) and reading `--measure`.
- Sans for display/reading, mono for machine truth (numbers, SHAs, paths, counts).
- No status token: every state carries a label plus a non-colour cue.

## Run it

```bash
pnpm --filter @doc-review/client exec vite --host 127.0.0.1
```

Then open `/studio.html` on the loopback dev server; expose to the tailnet with
Tailscale Serve. Toggle Paper/Ink from the masthead; click any PR card to open its
review surface.

## The answer

_Pending operator selection._ If the journey reads right, fold the dashboard + review
surface into the real client and delete this directory and `studio.html`.
