#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! -f "$1" ]]; then
  echo "Использование: scripts/release/smoke-release.sh <archive.tar.gz>" >&2
  exit 2
fi

archive_path="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
work_directory="$(mktemp -d)"
server_pid=""
cleanup() {
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf "$work_directory"
}
trap cleanup EXIT

tar -xzf "$archive_path" -C "$work_directory"
release_directory="$(find "$work_directory" -mindepth 1 -maxdepth 1 -type d -name 'grelqa-*' -print -quit)"
if [[ -z "$release_directory" || ! -x "$release_directory/bin/grelqa" ]]; then
  echo "Архив не содержит ожидаемый релизный каталог." >&2
  exit 1
fi

if find "$release_directory" -path "$release_directory/node_modules" -prune -o -type f \( -name '.env' -o -name '*.db' -o -name '*.db-wal' -o -name '*.db-shm' -o -name '*.sqlite' \) -print | grep -q .; then
  echo "В архив попали данные или .env." >&2
  exit 1
fi

database_path="$work_directory/data/smoke.db"
mail_directory="$work_directory/mail"
export NODE_ENV=production
export DATABASE_URL="file:$database_path"
export APP_URL=https://release-smoke.invalid
export SITE_URL=https://release-smoke.invalid
export SESSION_SECRET=release-smoke-session-secret-not-for-production-use
export MAIL_MODE=smtp
export MAIL_FROM=smoke@release-smoke.invalid
export SMTP_HOST=127.0.0.1
export SMTP_PORT=9
export SMTP_SECURE=false
export MAIL_DIRECTORY="$mail_directory"
export EXPORT_CACHE_DIRECTORY="$work_directory/exports"

cd "$release_directory"
bin/grelqa help >/dev/null
bin/grelqa migrate
bin/grelqa schedule
node --import tsx -e "import('@node-rs/argon2').then(async ({hash}) => { await hash('release-smoke-password'); })"

port="$(node -e "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")"
HOSTNAME=127.0.0.1 PORT="$port" bin/grelqa server >"$work_directory/server.log" 2>&1 &
server_pid=$!

ready=false
for _ in $(seq 1 60); do
  if node -e "fetch('http://127.0.0.1:$port/rules').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"; then
    ready=true
    break
  fi
  if ! kill -0 "$server_pid" 2>/dev/null; then break; fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  cat "$work_directory/server.log" >&2
  exit 1
fi

static_file="$(find .next/static -type f -print -quit)"
static_url="http://127.0.0.1:$port/_next/static/${static_file#.next/static/}"
node -e "fetch(process.argv[1]).then(r=>{if(!r.ok)throw new Error(String(r.status))})" "$static_url"
printf 'Релизный архив прошёл независимую smoke-проверку.\n'
