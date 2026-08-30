#!/bin/sh
set -e

# 永続ディスク上の SQLite にスキーマを適用してから起動する
echo "[entrypoint] prisma migrate deploy"
node_modules/.bin/prisma migrate deploy

echo "[entrypoint] next start on :${PORT:-3000}"
exec node_modules/.bin/next start -p "${PORT:-3000}" -H 0.0.0.0
