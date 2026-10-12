#!/bin/sh
# Runs once, when the Postgres volume is first created.
# Creates the database used by the e2e tests: <POSTGRES_DB>_test.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -c "CREATE DATABASE \"${POSTGRES_DB}_test\" OWNER \"${POSTGRES_USER}\";"
