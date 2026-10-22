#!/bin/sh
# Hosts such as Render mount the persistent disk owned by root. Fix ownership, then drop to the unprivileged "node" user.
set -e
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR"
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
