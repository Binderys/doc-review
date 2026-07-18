#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
run_id="$(date +%s)-$$"
project_name="doc-review-smoke-${run_id}"
image_repository="doc-review-smoke-${run_id}"
image_tag="$(git -C "${repo_root}" rev-parse HEAD)"
image_name="${image_repository}:${image_tag}"
latest_image_name="${image_repository}:latest"

export DOC_REVIEW_HOST_PORT=0
export DOC_REVIEW_IMAGE_REPOSITORY="${image_repository}"
export DOC_REVIEW_IMAGE_TAG="${image_tag}"

fail() {
  echo "Compose smoke failed: $*" >&2
  exit 1
}

[[ "${image_tag}" =~ ^[0-9a-f]{40}$ ]] || fail "source image tag is not a full Git SHA: ${image_tag}"

wait_for_healthy() {
  local container_id=$1
  local health_status=""
  for _ in {1..60}; do
    health_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "${container_id}")"
    if [[ "${health_status}" == "healthy" ]]; then
      return
    fi
    if [[ "${health_status}" == "unhealthy" ]]; then
      compose logs doc-review >&2
      fail "container became unhealthy"
    fi
    sleep 2
  done
  fail "container did not become healthy"
}

# Resolve the daemon and reject any impossible resource collision before creating
# the isolated project. The unique project label is also the cleanup boundary.
docker ps >/dev/null

if [[ -n "$(docker ps --all --quiet --filter "label=com.docker.compose.project=${project_name}")" ]]; then
  fail "Compose project already exists: ${project_name}"
fi

if docker image inspect "${image_name}" >/dev/null 2>&1; then
  fail "smoke image already exists: ${image_name}"
fi

if docker image inspect "${latest_image_name}" >/dev/null 2>&1; then
  fail "smoke image already exists: ${latest_image_name}"
fi

smoke_dir="$(mktemp -d "${TMPDIR:-/tmp}/doc-review-compose-smoke.XXXXXX")"
runtime_env="${smoke_dir}/runtime.env"
cleanup_temp() {
  rm -rf "${smoke_dir}"
}
trap cleanup_temp EXIT INT TERM

cat >"${runtime_env}" <<EOF
DOC_REVIEW_ENV_FILE=${runtime_env}
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
GITHUB_TOKEN=compose-smoke-not-a-live-token
WATCHED_REPOS=acme/review-loop-fixture
REVIEW_STATE_PATH=/data/review-state.json
DOC_REVIEW_GITHUB_SOURCE=compose-smoke
EOF

export DOC_REVIEW_ENV_FILE="${runtime_env}"

compose() {
  docker compose --env-file "${runtime_env}" --project-directory "${repo_root}" --project-name "${project_name}" "$@"
}

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  docker image rm "${image_name}" "${latest_image_name}" >/dev/null 2>&1 || true
  rm -rf "${smoke_dir}"
  exit "${exit_code}"
}
trap cleanup EXIT INT TERM

service_count="$(compose config --services | wc -l | tr -d ' ')"
[[ "${service_count}" == "1" ]] || fail "expected one Compose service, found ${service_count}"

volume_count="$(compose config --volumes | wc -l | tr -d ' ')"
[[ "${volume_count}" == "1" ]] || fail "expected one Compose volume, found ${volume_count}"

configured_image="$(compose config --images)"
[[ "${configured_image}" == "${image_name}" ]] || fail "configured image is ${configured_image}, expected ${image_name}"

build_definition="$(compose build --print)"
node -e '
  const assert = require("node:assert/strict");
  const definition = JSON.parse(process.argv[1]);
  const expectedTags = process.argv.slice(2).sort();
  const actualTags = definition.target["doc-review"].tags.toSorted();
  assert.deepEqual(actualTags, expectedTags);
' "${build_definition}" "${image_name}" "${latest_image_name}"

compose up --detach --build --force-recreate --pull never --wait --wait-timeout 180

container_id="$(compose ps --quiet doc-review)"
[[ -n "${container_id}" ]] || fail "Compose did not create the doc-review container"

wait_for_healthy "${container_id}"

configured_container_image="$(docker inspect --format '{{.Config.Image}}' "${container_id}")"
[[ "${configured_container_image}" == "${image_name}" ]] || fail "container image is ${configured_container_image}"

source_image_id="$(docker image inspect --format '{{.Id}}' "${image_name}")"
latest_image_id="$(docker image inspect --format '{{.Id}}' "${latest_image_name}")"
[[ "${source_image_id}" == "${latest_image_id}" ]] || fail "source and latest tags resolve to different images"

container_user="$(docker inspect --format '{{.Config.User}}' "${container_id}")"
[[ "${container_user}" == "node" ]] || fail "runtime user is ${container_user:-unset}, expected node"

restart_policy="$(docker inspect --format '{{.HostConfig.RestartPolicy.Name}}' "${container_id}")"
[[ "${restart_policy}" == "unless-stopped" ]] || fail "restart policy is ${restart_policy}"

network_mode="$(docker inspect --format '{{.HostConfig.NetworkMode}}' "${container_id}")"
[[ "${network_mode}" != "host" ]] || fail "host networking is forbidden"

host_ip="$(docker inspect --format '{{(index (index .NetworkSettings.Ports "3000/tcp") 0).HostIp}}' "${container_id}")"
host_port="$(docker inspect --format '{{(index (index .NetworkSettings.Ports "3000/tcp") 0).HostPort}}' "${container_id}")"
[[ "${host_ip}" == "127.0.0.1" ]] || fail "published host address is ${host_ip}"
[[ "${host_port}" =~ ^[1-9][0-9]*$ ]] || fail "published host port is ${host_port}"

image_architecture="$(docker image inspect --format '{{.Architecture}}' "${image_name}")"
[[ "${image_architecture}" == "arm64" ]] || fail "image architecture is ${image_architecture}"

volume_name="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "${container_id}")"
[[ "${volume_name}" == "${project_name}_review-state" ]] || fail "unexpected /data volume: ${volume_name:-missing}"

node "${repo_root}/scripts/compose-smoke.mjs" "http://${host_ip}:${host_port}" initial

compose up --detach --no-deps --force-recreate doc-review

recreated_container_id="$(compose ps --quiet doc-review)"
[[ -n "${recreated_container_id}" ]] || fail "Compose did not recreate the doc-review container"
[[ "${recreated_container_id}" != "${container_id}" ]] || fail "container identity did not change during recreation"
wait_for_healthy "${recreated_container_id}"

recreated_volume_name="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "${recreated_container_id}")"
[[ "${recreated_volume_name}" == "${volume_name}" ]] || fail "recreated container mounted a different review-state volume"

recreated_host_ip="$(docker inspect --format '{{(index (index .NetworkSettings.Ports "3000/tcp") 0).HostIp}}' "${recreated_container_id}")"
recreated_host_port="$(docker inspect --format '{{(index (index .NetworkSettings.Ports "3000/tcp") 0).HostPort}}' "${recreated_container_id}")"
node "${repo_root}/scripts/compose-smoke.mjs" "http://${recreated_host_ip}:${recreated_host_port}" retained

echo "Compose smoke passed (${project_name})"
