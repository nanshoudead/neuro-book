#!/usr/bin/env bash
set -euo pipefail

manager_version="$1"
candidate_manifest="$2"
root="$3"
port="$4"
engine="$5"

channel="$(node -e 'const m=require(process.argv[1]); process.stdout.write(m.channel)' "$candidate_manifest")"
export NEURO_BOOK_CONTAINER_ENGINE="$engine"
export NEURO_BOOK_MANAGER_CONFIG="${root}-manager/config.json"
export NO_COLOR=1
if [[ "$engine" == "podman" ]]; then
    export PODMAN_COMPOSE_PROVIDER="podman-compose"
fi

manager() {
    bunx --bun "@notnotype/neuro-book-manager@${manager_version}" "$@"
}

cleanup() {
    if [[ -f "$root/.deploy/docker-compose.generated.yml" ]]; then
        "$engine" compose --env-file "$root/.env" -f "$root/.deploy/docker-compose.generated.yml" down --remove-orphans || true
    fi
    rm -rf "$root" "${root}-manager"
}
trap cleanup EXIT INT TERM

rm -rf "$root" "${root}-manager"
mkdir -p "${root}-manager"
manager install \
    --profile ghcr \
    --channel "$channel" \
    --release-manifest "$candidate_manifest" \
    --dir "$root" \
    --port "$port" \
    --yes

manifest_engine="$(node -e 'const m=require(process.argv[1]); process.stdout.write(m.containerEngine ?? "")' "$root/.deploy/installation.json")"
[[ "$manifest_engine" == "$engine" ]] || { echo "Manifest engine错误：$manifest_engine != $engine" >&2; exit 1; }

export AUTH_ADMIN_PASSWORD="release-ghcr-password"
manager --root "$root" admin create release-ghcr-admin
unset AUTH_ADMIN_PASSWORD

base="http://127.0.0.1:${port}"
for attempt in $(seq 1 120); do
    if curl --fail --silent "$base/api/app/version" >/dev/null; then break; fi
    if [[ "$attempt" == 120 ]]; then exit 1; fi
    sleep 1
done

cookie="${root}-cookie.txt"
curl --fail --silent --show-error -c "$cookie" \
    -H 'content-type: application/json' \
    -d '{"username":"release-ghcr-admin","password":"release-ghcr-password"}' \
    "$base/api/auth/login" >/dev/null
curl --fail --silent --show-error -b "$cookie" "$base/api/auth/me" >/dev/null

manager --root "$root" doctor --json > "${root}-doctor-running.json"
node -e 'const r=require(process.argv[1]); if (!r.healthy || r.checks.some((c)=>c.status === "fail")) { console.error(JSON.stringify({service:r.service,failures:r.checks.filter((c)=>c.status === "fail")}, null, 2)); process.exit(1); }' "${root}-doctor-running.json"

if [[ "$engine" == "podman" ]]; then
    container_id="$("$engine" compose --env-file "$root/.env" -f "$root/.deploy/docker-compose.generated.yml" ps --quiet)"
    [[ "$container_id" =~ ^[a-f0-9]{12,64}$ ]] || { echo "Podman app容器ID非法：$container_id" >&2; exit 1; }
    "$engine" stop --time 10 "$container_id"
else
    "$engine" compose --env-file "$root/.env" -f "$root/.deploy/docker-compose.generated.yml" stop app
fi
manager --root "$root" doctor --json > "${root}-doctor-stopped.json"
node -e 'const r=require(process.argv[1]); if (!r.healthy || !r.checks.some((c)=>c.id === "service.application" && c.status === "warn")) { console.error(JSON.stringify({service:r.service,failures:r.checks.filter((c)=>c.status === "fail")}, null, 2)); process.exit(1); }' "${root}-doctor-stopped.json"
manager --root "$root" start

for attempt in $(seq 1 120); do
    if curl --fail --silent "$base/api/app/version" >/dev/null; then break; fi
    if [[ "$attempt" == 120 ]]; then exit 1; fi
    sleep 1
done
curl --fail --silent --show-error -b "$cookie" "$base/api/auth/me" >/dev/null

# Inject one planned Operation and let the public Manager recover it before its no-op update.
bun scripts/release/create-interrupted-operation.ts "$root"
manager --root "$root" update --channel "$channel" --release-manifest "$candidate_manifest" > "${root}-recovery.log"
node -e 'const fs=require("node:fs"); const root=process.argv[1]; const names=fs.readdirSync(root+"/.deploy/operations").filter((name)=>name.startsWith("release-recovery")); if (names.length !== 1 || JSON.parse(fs.readFileSync(root+"/.deploy/operations/"+names[0])).outcome !== "rolled-back") process.exit(1); if (fs.existsSync(root+"/.deploy/staging/release-recovery-marker")) process.exit(1)' "$root"
