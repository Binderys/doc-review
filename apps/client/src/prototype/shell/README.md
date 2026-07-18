# Editorial shell prototype (throwaway)

**This is a disposable UI prototype, not production code.** It answers one design
question and is meant to be deleted (or have its winning shell folded into the real
client) once that question is settled. It never ships: `shell-prototype.html` is not a
`vite build` input, and the floating selector is gated on `import.meta.env.DEV`.

## The question

How should the inherited Doc Review application _shell_ look once the binderys
bookbinding identity is translated into calm editorial application chrome, with the
authored document in focus and spatial rhythm first?

The chrome is the variable; the authored document is the constant. `ReadingPane` renders
identically in every shell so the document's appearance is preserved and only the shell
around it is judged.

## What it reuses from the canonical identity

Taken verbatim from `/Users/skhl/bootstrap/binderys/DESIGN.md` and `CONTEXT.md`:

- The two verified grounds (`--paper` / `--ink`) and their derived neutrals, with a
  persistent Paper/Ink control that wears the muted role, never the signature (theme is
  state, not identity).
- The seam mark and the `binderys` lockup, plus a sibling identity on the masthead line:
  `folio 01 - Doc Review` (Doc Review as folio 01 of the studio's own tools). The folio
  number wears the signature; the mark stays monochrome.
- The signature (oxblood) trio for identity moments only (folio and PR numbers, links);
  the waxed-thread pair for structure only (the dashed Binding rules, the sewn spine).
- The phi spacing scale (computed, not rounded), reading `--measure` and the `--container`
  that opens wide media to phi times measure.
- The type roles: a sans for display and reading, a mono for machine truth (SHAs, folio
  and round numbers, counts). No font is vendored; the canonical faces are named first
  and fall back to the platform stack.
- No status token: every state (change type, round status, carried/drifted, and the
  loading / empty / error roles) is carried by a label plus a non-colour cue, never by
  colour alone.

## The three shells (structurally different)

- **A - Codex spine** (`?variant=A`): a persistent left binding rail (Binding record,
  folio-numbered document index, shell states) sewn to the reading column by a dashed
  thread rule. Navigation-first.
- **B - Masthead ledger** (`?variant=B`): one centred editorial column; the Binding is a
  thin inline thread-ruled band, the document index a horizontal folio strip, the
  document beneath. Reading-first, no rail.
- **C - Split quire** (`?variant=C`): a document tab strip over two facing pages - the
  document canvas taking the golden share, its apparatus (Binding, summary, feedback,
  states) alongside. Working-desk density.

## Run it (one command)

```bash
pnpm --filter @doc-review/client exec vite --host 127.0.0.1
```

Then open `/shell-prototype.html?variant=A` on the loopback dev server (switch with
`?variant=A|B|C`, the floating selector, or the left-right arrow keys):
`http://127.0.0.1:5173/shell-prototype.html?variant=A`.

To reach it from another device on the tailnet, keep the dev server loopback-bound and
expose it with Tailscale Serve (`tailscale serve 5173`) rather than binding Vite to a
public interface.

## The answer

_Pending operator selection._ The interesting feedback is usually a graft ("the spine
from A with the reading column from B"). Record the chosen shell and the reason here,
then fold the winner into the real client and delete the losing shells, this directory,
and `shell-prototype.html`.
