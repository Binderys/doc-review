---
status: accepted
---

# Use one fine-grained PAT per GitHub resource owner

Doc Review authenticates to each GitHub resource owner with a separate operator-supplied
fine-grained personal access token restricted to read-only access for the selected watched
repos. A single classic token was rejected because it would broaden authority across
owners, while a GitHub App was rejected because private-key handling and installation-token
rotation add operational machinery that the current number of resource owners does not
justify. Production startup fails unless every watched repo's resource owner has its
corresponding credential. Credentials are startup state; rotation takes effect through the
normal controlled container recreation rather than runtime hot reload. Each credential is
supplied as `GITHUB_TOKEN_<NORMALIZED_OWNER>`, where the GitHub resource owner is uppercased
and hyphens become underscores.
