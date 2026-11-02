#!/bin/sh
# Starts the server as the unprivileged "node" user.
#
# The container starts as root only so it can hand the data directory to "node":
# a mounted volume (Railway, Coolify, a bind mount) is usually owned by root, and
# a plain `USER node` could then not write data.json. Then it drops privileges for
# good with setpriv (util-linux, part of the Debian base image).
set -e

if [ "$(id -u)" = "0" ]; then
  for dir in /app/data "${RAILWAY_VOLUME_MOUNT_PATH:-}" "$(dirname "${DATA_PATH:-/app/data/data.json}")"; do
    if [ -n "$dir" ] && [ -d "$dir" ]; then
      chown -R node:node "$dir"
    fi
  done
  exec setpriv --reuid=node --regid=node --init-groups -- "$@"
fi

exec "$@"
