#!/usr/bin/env bash
set -euo pipefail

# =============================================================
# Workhorse Nightly Backup Script
# Called by n8n at 02:00 daily
# =============================================================

DATESTAMP=$(date +%Y-%m-%d)
LOGFILE="/var/log/workhorse-backup.log"
CONTAINER="workhorse-postgres"
DB_NAME="workhorse"
DB_USER="workhorse_user"
USB_DIR="/mnt/usb-archive"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOGFILE"; }

log "=== Starting backup for ${DATESTAMP} ==="

# Check USB is mounted
if ! mountpoint -q "$USB_DIR"; then
  log "ERROR: USB archive not mounted at ${USB_DIR}"
  exit 1
fi

# 1. Database dump
log "Dumping PostgreSQL database..."
docker exec "$CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" | \
  gzip > "${USB_DIR}/daily/workhorse-${DATESTAMP}.sql.gz"
log "  Database dump saved: workhorse-${DATESTAMP}.sql.gz"

# 2. Sync parsed data
log "Syncing parsed project data..."
mkdir -p "${USB_DIR}/daily/parsed-${DATESTAMP}"
rsync -a /srv/projects/*/parsed/ "${USB_DIR}/daily/parsed-${DATESTAMP}/" 2>/dev/null || true
log "  Parsed data synced"

# 3. Sync digests
log "Syncing digest files..."
mkdir -p "${USB_DIR}/daily/digests-${DATESTAMP}"
rsync -a /srv/shared/digests/ "${USB_DIR}/daily/digests-${DATESTAMP}/" 2>/dev/null || true
log "  Digests synced"

# 4. Prune daily backups older than 30 days
log "Pruning daily backups older than 30 days..."
find "${USB_DIR}/daily/" -maxdepth 1 -mtime +30 -exec rm -rf {} \; 2>/dev/null || true
log "  Pruning complete"

# 5. Weekly full archive on Sundays
if [ "$(date +%u)" = "7" ]; then
  log "Sunday detected — creating weekly project archive..."
  tar -czf "${USB_DIR}/weekly/projects-${DATESTAMP}.tar.gz" /srv/projects/ 2>/dev/null || true
  log "  Weekly archive saved: projects-${DATESTAMP}.tar.gz"
fi

log "=== Backup complete for ${DATESTAMP} ==="
exit 0
