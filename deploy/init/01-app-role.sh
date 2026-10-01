#!/bin/sh
# The API's role: it logs in, and row-level security always applies to it (no BYPASSRLS).
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_password="$APP_PASSWORD" <<'SQL'
create role enterprise_app with login nobypassrls password :'app_password';
create extension if not exists vector;
SQL
