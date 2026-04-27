#!/bin/sh
set -e

mkdir -p "${FRAME_SAVE_PATH:-/data/frames}"
chown -R stream:nodejs /data

exec su-exec stream "$@"
