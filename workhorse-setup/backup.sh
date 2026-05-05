#!/usr/bin/env bash
set -euo pipefail

DATESTAMP=$(date +%Y-%m-%d)
LOGFILE="/mnt/usb-archive/logs/backup.log"
CONTAINER="workhorse-postgres"
DB_NAME="workhorse"
DB_USER="workhorse_user"

SSD_ARCHIVE="/mnt/usb-archive"
TOSHIBA="/media/richard-knapp/Old MS File/workhorse-archive"
GDRIVE="gdrive5tb:workhorse-archive"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOGFILE"; }

log "=== Starting backup for ${DATESTAMP} ==="

# 1. Database dump to SSD archive
log "Dumping PostgreSQL database..."
mkdir -p "${SSD_ARCHIVE}/backups/daily"
docker exec "$CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" | \
  gzip > "${SSD_ARCHIVE}/backups/daily/workhorse-${DATESTAMP}.sql.gz"
log "  Database dump saved"

# 2. Sync scraper raw data to SSD archive
log "Syncing scraper output..."
rsync -a /srv/scrapers/output/ "${SSD_ARCHIVE}/raw/" 2>/dev/null || true
log "  Scraper data synced to SSD"

# 3. Copy to TOSHIBA if mounted
if [ -d "$TOSHIBA" ]; then
  log "Syncing to TOSHIBA..."
  rsync -a "${SSD_ARCHIVE}/backups/" "${TOSHIBA}/backups/" 2>/dev/null || true
  rsync -a "${SSD_ARCHIVE}/raw/" "${TOSHIBA}/raw/" 2>/dev/null || true
  rsync -a "${SSD_ARCHIVE}/reports/" "${TOSHIBA}/reports/" 2>/dev/null || true
  log "  TOSHIBA sync complete"
else
  log "  TOSHIBA not mounted — skipping"
fi

# 4. Sync to Google Drive
if command -v rclone &>/dev/null; then
  log "Syncing to Google Drive..."
  rclone sync "${SSD_ARCHIVE}/backups/" "${GDRIVE}/backups/" --quiet 2>/dev/null || true
  rclone sync "${SSD_ARCHIVE}/raw/" "${GDRIVE}/raw/" --quiet 2>/dev/null || true
  rclone sync "${SSD_ARCHIVE}/reports/" "${GDRIVE}/reports/" --quiet 2>/dev/null || true
  rclone copy "${SSD_ARCHIVE}/backups/daily/workhorse-${DATESTAMP}.sql.gz" \
    "${GDRIVE}/databases/" --quiet 2>/dev/null || true
  log "  Google Drive sync complete"
else
  log "  rclone not found — skipping cloud sync"
fi

# 5. Prune daily backups older than 30 days
log "Pruning backups older than 30 days..."
find "${SSD_ARCHIVE}/backups/daily/" -maxdepth 1 -mtime +30 -exec rm -rf {} \; 2>/dev/null || true
log "  Pruning complete"

# 6. Weekly full archive on Sundays
if [ "$(date +%u)" = "7" ]; then
  log "Sunday — creating weekly scraper archive..."
  mkdir -p "${SSD_ARCHIVE}/backups/weekly"
  tar -czf "${SSD_ARCHIVE}/backups/weekly/scrapers-${DATESTAMP}.tar.gz" /srv/scrapers/ \
    --exclude='.venv' --exclude='__pycache__' 2>/dev/null || true
  log "  Weekly archive saved"
fi

log "=== Backup complete for ${DATESTAMP} ==="
exit 0
