#!/bin/sh
set -e

# Install dependencies when they are missing or package files changed since the last install.
if [ ! -d node_modules/.bin ] \
  || [ package.json -nt node_modules/.package-lock.json ] \
  || { [ -f package-lock.json ] && [ package-lock.json -nt node_modules/.package-lock.json ]; }; then
  echo "Installing dependencies..."
  npm install --no-audit --no-fund --no-update-notifier
  touch node_modules/.package-lock.json
fi

# Build the database URLs from the Postgres credentials in .envs/db.env.
# "db" is the Postgres service name in docker-compose.yml.
export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}"
export TEST_DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}_test"

exec "$@"
