---
status: accepted
---

# Watched repos are the GitHub read allowlist

Doc Review admits GitHub reads only for repos named in `WATCHED_REPOS`; dashboard,
review-surface, and raw-document paths reject every other repo before selecting a
credential or contacting GitHub. The previous behavior treated the list as dashboard
discovery only, but preserving direct-route access to every repo a credential happened to
permit would let credential scope silently widen the application's confidentiality
boundary.
