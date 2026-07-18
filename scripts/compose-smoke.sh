#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
run_id="$(date +%s)-$$"
project_name="doc-review-smoke-${run_id}"
image_tag="smoke-${run_id}"
image_name="doc-review:${image_tag}"

export DOC_REVIEW_HOST_PORT=0
export DOC_REVIEW_IMAGE_TAG="${image_tag}"

compose() {
  docker compose --project-directory "${repo_root}" --project-name "${project_name}" "$@"
}

fail() {
  echo "Compose smoke failed: $*" >&2
  exit 1
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

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  docker image rm "${image_name}" >/dev/null 2>&1 || true
  exit "${exit_code}"
}
trap cleanup EXIT INT TERM

service_count="$(compose config --services | wc -l | tr -d ' ')"
[[ "${service_count}" == "1" ]] || fail "expected one Compose service, found ${service_count}"

compose up --detach --build

container_id="$(compose ps --quiet doc-review)"
[[ -n "${container_id}" ]] || fail "Compose did not create the doc-review container"

health_status=""
for _ in {1..60}; do
  health_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "${container_id}")"
  if [[ "${health_status}" == "healthy" ]]; then
    break
  fi
  if [[ "${health_status}" == "unhealthy" ]]; then
    compose logs doc-review >&2
    fail "container became unhealthy"
  fi
  sleep 2
done
[[ "${health_status}" == "healthy" ]] || fail "container did not become healthy"

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

node "${repo_root}/scripts/compose-smoke.mjs" "http://${host_ip}:${host_port}"

echo "Compose smoke passed (${project_name})"
