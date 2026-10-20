#!/bin/sh
# Runs once, the first time the Postgres volume is created.
# Roles: digi_owner runs migrations and owns the schema; digi_app is the runtime role (cannot bypass row-level security);
# owui_app owns the Open WebUI database. The passwords come from the container environment (set in .env, never committed).
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE digi_owner LOGIN PASSWORD '${DIGI_OWNER_PASSWORD}';
CREATE ROLE digi_app   LOGIN PASSWORD '${DIGI_APP_PASSWORD}' NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE owui_app   LOGIN PASSWORD '${OWUI_DB_PASSWORD}' NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE digi OWNER digi_owner;
CREATE DATABASE owui OWNER owui_app;
REVOKE ALL ON DATABASE digi FROM PUBLIC;
REVOKE ALL ON DATABASE owui FROM PUBLIC;
GRANT CONNECT ON DATABASE digi TO digi_app;
SQL

# digi: the runtime role gets only what the owner grants. Tables the owner creates later are granted by default.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname digi <<SQL
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO digi_app;
ALTER DEFAULT PRIVILEGES FOR ROLE digi_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO digi_app;
ALTER DEFAULT PRIVILEGES FOR ROLE digi_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO digi_app;
SQL
