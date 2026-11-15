#!/usr/bin/env bash
set -Eeuo pipefail

BASE="$(pwd -P)"
ARCHIVE="$(realpath "${1:?Usage: deploy.sh <archive>}")"
export NVM_DIR="$HOME/.nvm"

fail() {
    echo "$*" >&2
    exit 1
}

[[ -r "$ARCHIVE" ]] || fail "Missing deployment archive: $ARCHIVE"
[[ -r "$BASE/config.json" ]] || fail "Missing bot config: $BASE/config.json"
[[ -f "$NVM_DIR/nvm.sh" ]] || fail "Missing nvm: $NVM_DIR/nvm.sh"

exec 9>"$BASE/deploy.lock"
flock -n 9 || fail 'Another deployment is running'

STAGING="$(mktemp -d "$BASE/.deploy.XXXXXXXXXX")"
trap 'rm -rf -- "$STAGING"' EXIT

# Runtime files in the deployment directory are managed by the bot.
extract_release() {
    tar -xzf "$ARCHIVE" -C "$1" --no-same-owner --no-overwrite-dir \
        --anchored --exclude=config.json --exclude=database.json \
        --exclude=database.sqlite3 --exclude=node_modules
}

extract_release "$STAGING"

for required_file in package.json .nvmrc ecosystem.config.cjs; do
    [[ -f "$STAGING/$required_file" ]] || fail "Deployment archive is missing $required_file"
done

# shellcheck source=/dev/null
source "$NVM_DIR/nvm.sh"
cd "$STAGING"
nvm use
command -v pm2 >/dev/null || fail 'PM2 is missing for the selected Node version'
npm ci --omit=dev

cd "$BASE"
extract_release "$BASE"

if [[ -e node_modules || -L node_modules ]]; then
    mv -T -- node_modules "$STAGING/previous-node_modules"
fi

if ! mv -T -- "$STAGING/node_modules" node_modules; then
    if [[ -e "$STAGING/previous-node_modules" || -L "$STAGING/previous-node_modules" ]]; then
        mv -T -- "$STAGING/previous-node_modules" node_modules
    fi
    fail 'Could not install the new node_modules directory'
fi

pm2 startOrReload ecosystem.config.cjs --env production
pm2 save
echo 'qoqbot deployment completed'
