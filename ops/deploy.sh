#!/usr/bin/env bash
set -Eeuo pipefail

BASE='/opt/servers/qoqbot'
ARCHIVE="$BASE/upload/qoqbot.tar.gz"
APP="$BASE/app"
NEXT="$BASE/app.next"
OLD="$BASE/app.old"
SHARED="$BASE/shared"

export HOME='/home/nodeapp'
export NVM_DIR="$HOME/.nvm"

fail() {
    echo "$*" >&2
    exit 1
}

cleanup_next() {
    rm -rf "$NEXT"
}

[[ "$(id -un)" == 'nodeapp' ]] || fail 'deploy.sh must run as nodeapp'
[[ -d "$BASE/upload" ]] || fail "Missing deployment upload directory: $BASE/upload"
[[ -d "$SHARED" ]] || fail "Missing shared directory: $SHARED"
[[ -f "$ARCHIVE" ]] || fail "Missing deployment archive: $ARCHIVE"
[[ -f "$SHARED/config.json" ]] || fail "Missing shared config: $SHARED/config.json"
[[ -f "$NVM_DIR/nvm.sh" ]] || fail "Missing nvm: $NVM_DIR/nvm.sh"

exec 9>"$BASE/deploy.lock"
flock -n 9 || fail 'Another deployment is running'

trap cleanup_next EXIT

rm -rf "$NEXT"
mkdir -p "$NEXT"
tar -xzf "$ARCHIVE" -C "$NEXT"

[[ -f "$NEXT/package.json" ]] || fail 'Deployment archive does not contain package.json'
[[ -f "$NEXT/.nvmrc" ]] || fail 'Deployment archive does not contain .nvmrc'
[[ -f "$NEXT/ecosystem.config.cjs" ]] || fail 'Deployment archive does not contain ecosystem.config.cjs'

ln -sfn "$SHARED/config.json" "$NEXT/config.json"

for state_file in database.json database.sqlite3; do
    if [[ -f "$SHARED/$state_file" ]]; then
        ln -sfn "$SHARED/$state_file" "$NEXT/$state_file"
    fi
done

# shellcheck source=/dev/null
source "$NVM_DIR/nvm.sh"

cd "$NEXT"
nvm use
npm ci --omit=dev

rm -rf "$OLD"

if [[ -d "$APP" ]]; then
    mv "$APP" "$OLD"
fi

if ! mv "$NEXT" "$APP"; then
    echo 'Application directory switch failed; restoring previous application' >&2

    if [[ -d "$OLD" ]]; then
        mv "$OLD" "$APP" || true
    fi

    exit 1
fi

cd "$APP"

if ! pm2 startOrReload ecosystem.config.cjs --env production; then
    echo 'PM2 reload failed; restoring previous application' >&2
    rm -rf "$APP"

    if [[ -d "$OLD" ]]; then
        mv "$OLD" "$APP"
        cd "$APP"
        pm2 startOrReload ecosystem.config.cjs --env production || true
    fi

    exit 1
fi

pm2 save
rm -rf "$OLD"
rm -f "$ARCHIVE"

echo 'qoqbot deployment completed'
