---
status: accepted
---

# Isolate dashboard failures by watched repo

The dashboard returns available watched repos even when another watched repo's live GitHub
read fails, representing each failure explicitly in that repo's result. Failing the entire
dashboard was rejected because a revoked credential, rate limit, timeout, or provider error
for one resource owner must not hide healthy repos owned by another; review and raw-document
requests still fail when their own repo cannot be read. The dashboard contract exposes only
stable `access`, `rate-limited`, and `github-unavailable` reasons; raw provider messages and
request identifiers remain server diagnostics.
