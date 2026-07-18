# Binderys-mini deployment and rollback

This is the operator handoff for the single Doc Review instance on Binderys-mini. It
builds on Binderys-mini from a verified green Git commit, keeps images local, and uses
the same Compose project, operator `.env`, and review-state volume for deploys and
rollbacks. It does not use an image registry or a CI image-delivery workflow.

Commands in the approval sections change the host or the running service. Do not run
them through unattended automation. The routine verification commands are read-only.

## One-time host prerequisites - approval required

These settings form a startup chain: macOS logs in the service account, OrbStack starts
at login, and Docker recovers the container under its restart policy.

1. In **System Settings > Users & Groups**, set **Automatically log in as** to the
   service account. Apple disables automatic login while FileVault is on, so this
   operating model requires FileVault to be off. Disabling FileVault reduces physical
   security and is a separate operator decision, never a deployment command. Check its
   state without changing it with `fdesetup status`.
2. In **OrbStack > Settings**, enable **Start at login**. Check the effective setting
   without changing it with `orbctl config get app.start_at_login`; it must print
   `true`. OrbStack starts after login, not before it, which is why automatic login is
   part of the chain.
3. Keep Tailscale signed in on Binderys-mini and keep its machine name stable. In the
   tailnet DNS admin page, enable MagicDNS and **HTTPS Certificates**. Enabling HTTPS
   publishes the machine and tailnet DNS names to Certificate Transparency; review
   those names before accepting. Record the resulting origin as:

   ```text
   https://binderys-mini.<tailnet-name>.ts.net
   ```

4. After the service is healthy on `127.0.0.1:3000`, approve and create the persistent
   private reverse proxy. This is a Tailscale configuration change and is not part of
   Compose deployment:

   ```bash
   TAILSCALE_BE_CLI=1 /Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg --https=443 http://127.0.0.1:3000
   ```

   `--bg` makes this Serve configuration resume after a Tailscale restart or host
   reboot. Do not use Tailscale Funnel; Funnel would make the service public. Check the
   mapping without changing it:

   ```bash
   TAILSCALE_BE_CLI=1 /Applications/Tailscale.app/Contents/MacOS/Tailscale serve status
   ```

Doc Review has no application login. In the current single-operator tailnet, tailnet
membership is the only access gate. Tailscale's default policy allows connections among
tailnet devices. Before adding another tailnet member or sharing Binderys-mini with
another user, add a restricted Tailscale grant or ACL that permits only the operator's
identity to reach Binderys-mini on `tcp:443`. That membership or sharing change is the
trigger - do not add the user first and tighten access later. Prefer a grant for a new
policy; Tailscale describes grants as the current syntax. The exact identity and host
selectors belong to the tailnet policy, not this repository.

## Prepare the operator environment

Work from one dedicated checkout whose directory remains the Compose project directory.
Create the ignored operator file once and retain it across deployments:

```bash
cp .env.example .env
chmod 600 .env
```

Set `GITHUB_TOKEN` to a read-scope token and `WATCHED_REPOS` to the real comma-separated
repository list. Do not source `.env`; Compose reads it with `--env-file .env` and also
passes it to the service. Keep `DOC_REVIEW_HOST_PORT` unset to use `3000`, because the
persistent Serve mapping below targets that loopback port.

## Select and verify a green main SHA

The image tag is the full 40-character commit SHA on `main`. This repository does not
run a redundant post-merge workflow on `main`, so establish green provenance through
the merged pull request whose required checks admitted that main commit.

```bash
git fetch origin main
git log --first-parent --format='%H %s' origin/main
```

Copy the intended full SHA from that log into `green_sha`, then prove that it is a
commit reachable from fetched `main`:

```bash
green_sha=<40-character-main-sha>
git rev-parse --verify "${green_sha}^{commit}"
git merge-base --is-ancestor "$green_sha" origin/main
```

Find the pull request associated with that commit, copy its number into `pr_number`,
and verify both the merge SHA and its required checks:

```bash
gh api "repos/Binderys/doc-review/commits/${green_sha}/pulls" --jq '.[] | {number, merged_at, title}'
pr_number=<associated-merged-pr-number>
gh pr view "$pr_number" --repo Binderys/doc-review --json mergeCommit,state,url
gh pr checks "$pr_number" --repo Binderys/doc-review --required
```

Continue only when the PR is merged, `mergeCommit.oid` equals `green_sha`, and
`gh pr checks --required` exits zero. A pending, failed, or missing required check is
not green. Make sure the deployment checkout has no tracked or untracked work, then
check out that exact source:

```bash
git status --short
git switch --detach "$green_sha"
git rev-parse HEAD
```

Stop if `git status --short` was not empty. Do not delete or overwrite local files to
make it empty. The final `git rev-parse HEAD` output must equal `green_sha` exactly.

## Deploy in one Compose command - approval required

This command builds natively on Binderys-mini, tags the result as both
`doc-review:<green_sha>` and `doc-review:latest`, replaces the service, waits for its
health check, and reattaches the existing `doc-review_review-state` volume:

```bash
DOC_REVIEW_IMAGE_TAG="$green_sha" docker compose --env-file .env --project-name doc-review up --detach --build --force-recreate --pull never --wait --wait-timeout 180
```

The explicit project name is what keeps the runtime configuration and named volume
stable across deploy and rollback. `--pull never` applies to the service image: delivery
is always the local build. The Dockerfile can still obtain its pinned base image from
its normal upstream when that base is absent locally.

## Verify the deployment

Set `green_sha` and `tailscale_url` to the values selected above. Export the image tag
because every Compose command parses the required `DOC_REVIEW_IMAGE_TAG` interpolation,
including read-only commands. These checks do not change the running service:

```bash
green_sha=<40-character-main-sha>
export DOC_REVIEW_IMAGE_TAG="$green_sha"
tailscale_url=https://binderys-mini.<tailnet-name>.ts.net
container_id=$(docker compose --env-file .env --project-name doc-review ps --quiet doc-review)

docker compose --env-file .env --project-name doc-review ps
docker inspect --format 'health={{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}} restart={{.HostConfig.RestartPolicy.Name}} image={{.Config.Image}}' "$container_id"
docker inspect --format '{{range .NetworkSettings.Ports}}{{range .}}{{.HostIp}}:{{.HostPort}}{{end}}{{end}}' "$container_id"
docker inspect --format '{{range .Mounts}}{{.Type}} {{.Name}} -> {{.Destination}}{{println}}{{end}}' "$container_id"
docker image inspect --format '{{.Id}} {{json .RepoTags}}' "doc-review:${green_sha}" doc-review:latest
curl --fail --silent --show-error http://127.0.0.1:3000/health
TAILSCALE_BE_CLI=1 /Applications/Tailscale.app/Contents/MacOS/Tailscale serve status
curl --fail --silent --show-error "${tailscale_url}/health"
```

All of the following must be true:

- Compose reports the container healthy.
- The inspect line reports `health=healthy`, `restart=unless-stopped`, and
  `image=doc-review:<green_sha>`.
- The only published address is `127.0.0.1:3000`, never `0.0.0.0`, `::`, a LAN
  address, or a Tailscale address.
- A named volume called `doc-review_review-state` is mounted at `/data`.
- The SHA tag and `latest` tag report the same image ID.
- Both health requests return the JSON health response with HTTP 200.
- Serve status maps the Binderys-mini HTTPS MagicDNS origin to
  `http://127.0.0.1:3000`.

The health check is observational. `restart: unless-stopped` restarts the container
when its process exits, subject to Docker's restart-policy rules. An `unhealthy` status
does not itself restart the process, and this deployment includes no autoheal service.
Investigate an unhealthy container; do not claim recovery because the status exists.

## Roll back - approval required

Choose an older commit from `origin/main` and repeat **Select and verify a green main
SHA** with that SHA. The rollback target must contain the Compose service and persistent
review-state contract; do not guess that an older application-only commit is
deployable. Keep the same checkout directory and `.env`, set `green_sha` to the older
verified commit, and check it out:

```bash
git switch --detach "$green_sha"
git rev-parse HEAD
```

After the output matches `green_sha`, run the single canonical command under
**Deploy in one Compose command** without changing its flags. It rebuilds the older
source natively, moves the local `doc-review:latest` alias to that build, and starts it
with the same operator environment and
`doc-review_review-state` volume. Run the full deployment verification afterward and
confirm existing review work in the UI. Rollback changes application code, not the
persisted data schema; if a future release introduces an incompatible state migration,
that release must add its own rollback boundary.

## Cold-reboot verification - separate approval required

Do not combine this with routine deployment. A reboot interrupts every service on this
always-on host and requires explicit operator approval at the time of the test. Before
requesting approval, record the current Tailscale URL and create or identify review work
whose retention can be checked afterward.

After approval, reboot the host using the operator's normal macOS procedure. Success is
all four of the following, with no manual application start:

1. Automatic login occurs and OrbStack starts at login.
2. The `doc-review` container recovers and becomes healthy under
   `restart: unless-stopped`.
3. The pre-reboot review work is still present through the same
   `doc-review_review-state` volume.
4. The same HTTPS MagicDNS URL returns `/health` and the review surface, with Serve
   still mapped to `127.0.0.1:3000`.

Use the deployment verification commands after the host returns. Any manual OrbStack,
container, or Serve start means the cold-reboot test failed even if the service later
works.

## Command and behavior sources

- Installed local help: Docker Compose v5.1.2 `build`, `up`, and `config`; OrbStack
  v2.1.3 `config get/show/set`; Git `switch`, `merge-base`, and `rev-parse`; GitHub CLI
  `pr checks`, `run list`, and `run view`.
- [Docker Compose build tags](https://docs.docker.com/reference/compose-file/build/#tags)
  confirms that `build.tags` adds tags alongside the service `image` tag.
- [Tailscale Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve)
  owns the current reverse-proxy, `--bg`, HTTPS, status, and reboot persistence syntax.
- [Tailscale CLI on macOS](https://tailscale.com/docs/reference/tailscale-cli?tab=macos)
  owns the app-bundle path and `TAILSCALE_BE_CLI=1` override.
- [Tailscale HTTPS setup](https://tailscale.com/docs/how-to/set-up-https-certificates)
  owns the MagicDNS, HTTPS enablement, and Certificate Transparency prerequisites.
- [Tailscale access controls](https://tailscale.com/docs/features/access-control/acls)
  documents the default allow policy; [grant syntax](https://tailscale.com/docs/reference/syntax/grants)
  documents restricted `tcp:443` grants.
- [Apple automatic login](https://support.apple.com/en-us/102316) documents the
  Users & Groups setting and the FileVault-off constraint.
