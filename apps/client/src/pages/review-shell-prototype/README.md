# Review shell prototype

Question: how should the inherited Doc Review client become a high-density Binderys
review workstation without changing routes, contracts, lifecycle, product behaviour,
or the appearance of authored documents?

Run from the repository root:

```bash
pnpm --filter @doc-review/client dev
```

Open the existing review route with one of the three development-only variants:

- `/pr/Binderys/doc-review/33?variant=ledger`
- `/pr/Binderys/doc-review/33?variant=proof`
- `/pr/Binderys/doc-review/33?variant=register`

The bottom control and the left/right arrow keys cycle between variants. The ground
control persists its paper/ink choice in browser storage. All content is a deterministic
fixture and no API call or product mutation is made while a variant is active.

Delete this directory and the development-only gate in `App.tsx` after the workstation
direction is chosen.
