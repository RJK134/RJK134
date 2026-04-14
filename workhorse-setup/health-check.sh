#!/usr/bin/env bash
# =============================================================
# Workhorse Health Check — outputs single JSON object
# Called by n8n at 05:45 daily and on-demand
# Always exits 0 (health data, not health assertion)
# =============================================================

DISK=$(df / | awk 'NR==2{print $5}' | tr -d '%')
RAM=$(free -m | awk 'NR==2{print $3}')

if mountpoint -q /mnt/usb-archive 2>/dev/null; then
  USB="true"
else
  USB="false"
fi

if docker exec workhorse-postgres pg_isready -U postgres > /dev/null 2>&1; then
  DB="true"
else
  DB="false"
fi

LAST=$(find /mnt/usb-archive/daily/ -name "workhorse-*.sql.gz" -printf '%T@\n' 2>/dev/null | sort -n | tail -1)
if [ -n "$LAST" ]; then
  AGE=$(( ($(date +%s) - ${LAST%.*}) / 3600 ))
else
  AGE=999
fi

printf '{"disk_used_pct":%s,"usb_mounted":%s,"ram_used_mb":%s,"db_reachable":%s,"backup_age_hours":%s,"checked_at":"%s"}\n' \
  "$DISK" "$USB" "$RAM" "$DB" "$AGE" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

exit 0
