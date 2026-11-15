#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$project_root"

if [[ ! -f .next/standalone/server.js ]]; then
  echo "Сначала выполните production-сборку с output: standalone." >&2
  exit 1
fi

output_directory="${1:-$project_root/dist}"
commit_sha="${GRELQA_RELEASE_COMMIT:-$(git rev-parse HEAD)}"
short_sha="${commit_sha:0:12}"
archive_base="grelqa-${short_sha}-linux-x64"
work_directory="$(mktemp -d)"
trap 'rm -rf "$work_directory"' EXIT
release_directory="$work_directory/$archive_base"

mkdir -p "$release_directory/.next/static" "$release_directory/bin" "$release_directory/docs"
cp -a .next/standalone/. "$release_directory/"
cp -a .next/static/. "$release_directory/.next/static/"
if [[ -d public ]]; then cp -a public "$release_directory/public"; fi

# Output tracing may copy files reached through dynamic filesystem paths from a
# developer checkout. A release must never inherit local state from that trace.
rm -rf \
  "$release_directory/.env" \
  "$release_directory/.env.local" \
  "$release_directory/.env.development" \
  "$release_directory/.env.production" \
  "$release_directory/.env.test" \
  "$release_directory/.local" \
  "$release_directory/data" \
  "$release_directory/coverage" \
  "$release_directory/playwright-report" \
  "$release_directory/test-results"

cp -a src scripts drizzle deploy "$release_directory/"
cp -a package.json package-lock.json .env.example LICENSE COPYRIGHT THIRD_PARTY_NOTICES.md third_party "$release_directory/"
cp -a bin/grelqa "$release_directory/bin/grelqa"
cp -a docs/deployment.md docs/release-archive.md "$release_directory/docs/"
chmod 0755 "$release_directory/bin/grelqa"

# Standalone tracing does not cover separately executed TypeScript CLI files.
# Build a clean production dependency tree and overlay it onto the traced tree.
dependency_directory="$work_directory/runtime-dependencies"
mkdir -p "$dependency_directory"
cp package.json package-lock.json "$dependency_directory/"
npm ci --omit=dev --ignore-scripts --prefix "$dependency_directory"
cp -a "$dependency_directory/node_modules/." "$release_directory/node_modules/"

node_version="$(node --version)"
os_description="$(. /etc/os-release && printf '%s' "$PRETTY_NAME")"
architecture="$(uname -m)"
cat > "$release_directory/RELEASE-METADATA.txt" <<EOF
commit_sha=$commit_sha
node_version=$node_version
build_os=$os_description
build_architecture=$architecture
runner_image=${ImageOS:-local}
EOF

if find "$release_directory" -path "$release_directory/node_modules" -prune -o -type f \( \
  -name '.env' -o -name '*.db' -o -name '*.db-wal' -o -name '*.db-shm' \
  -o -name '*.sqlite' -o -name '*.sqlite-wal' -o -name '*.sqlite-shm' \
  -o -name '*.log' -o -name '*.zip' \) -print | grep -q .; then
  echo "Сборка остановлена: в staging попали локальные данные, логи или секреты." >&2
  exit 1
fi

mkdir -p "$output_directory"
archive_path="$output_directory/$archive_base.tar.gz"
tar -C "$work_directory" -czf "$archive_path" "$archive_base"
(cd "$output_directory" && sha256sum "$(basename "$archive_path")") > "$archive_path.sha256"
cp "$release_directory/RELEASE-METADATA.txt" "$archive_path.metadata.txt"
printf '%s\n' "$archive_path"
