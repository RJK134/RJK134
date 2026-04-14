#!/usr/bin/env bash
set -euo pipefail

# =============================================================
# Initialise the workhorse PostgreSQL database
# Waits for container, creates user/db, loads schema
# =============================================================

CONTAINER="workhorse-postgres"
DB_USER="workhorse_user"
DB_PASS="changeme_secure"  # CHANGE THIS BEFORE DEPLOYING
DB_NAME="workhorse"

echo "Waiting for PostgreSQL container to be ready..."
for i in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U postgres > /dev/null 2>&1; then
    echo "PostgreSQL is ready (attempt $i)."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: PostgreSQL did not become ready after 30 attempts."
    exit 1
  fi
  echo "  Waiting... attempt $i/30"
  sleep 3
done

echo ""
echo "Creating user '${DB_USER}' if not exists..."
docker exec "$CONTAINER" psql -U postgres -c \
  "DO \$\$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${DB_USER}') THEN
      CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';
    END IF;
  END \$\$;"

echo "Creating database '${DB_NAME}' if not exists..."
DB_EXISTS=$(docker exec "$CONTAINER" psql -U postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'")
if [ "$DB_EXISTS" != "1" ]; then
  docker exec "$CONTAINER" psql -U postgres -c \
    "CREATE DATABASE ${DB_NAME} OWNER postgres ENCODING 'UTF8' TEMPLATE template0;"
  echo "  Database created."
else
  echo "  Database already exists."
fi

docker exec "$CONTAINER" psql -U postgres -c \
  "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};"
docker exec "$CONTAINER" psql -U postgres -d "${DB_NAME}" -c \
  "GRANT ALL ON SCHEMA public TO ${DB_USER};"

echo ""
echo "Loading schema from schema.sql..."
SCHEMA_PATH="/srv/core/schema.sql"
if [ ! -f "$SCHEMA_PATH" ]; then
  SCHEMA_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/schema.sql"
fi

docker cp "$SCHEMA_PATH" "${CONTAINER}:/tmp/schema.sql"
docker exec "$CONTAINER" psql -U postgres -d "${DB_NAME}" -f /tmp/schema.sql

echo ""
echo "=== Database Initialisation Complete ==="
echo ""
echo "Tables created:"
docker exec "$CONTAINER" psql -U postgres -d "${DB_NAME}" -c "\dt"

echo ""
echo "Projects seeded:"
docker exec "$CONTAINER" psql -U postgres -d "${DB_NAME}" -c \
  "SELECT slug, display_name, priority FROM projects ORDER BY priority, slug;"

echo ""
echo "Row counts:"
for tbl in projects sources jobs captures entities opportunities market_signals notes alerts digests health_logs; do
  COUNT=$(docker exec "$CONTAINER" psql -U postgres -d "${DB_NAME}" -tAc "SELECT COUNT(*) FROM ${tbl};")
  printf "  %-20s %s rows\n" "$tbl" "$COUNT"
done
