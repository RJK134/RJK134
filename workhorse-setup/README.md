# MacBook Pro 2013 — Ubuntu Headless Background Workhorse

**For: Richard Knapp — Future Horizons Education / SJMS / Personal Project Estate**

A complete automation stack for running background data collection, monitoring,
and digest generation across 8 active projects on a headless Ubuntu MacBook Pro.

## What This Stack Does

- **PostgreSQL 15** on port 5433 (avoids SJMS conflict on 5432) with a full
  schema for tracking projects, sources, captures, entities, opportunities,
  market signals, notes, alerts, digests, and health logs
- **n8n** workflow automation on port 5678 with 14 pre-built workflows for
  daily/weekly data collection, digest generation, backups, and health checks
- **Automated backups** to USB archive with 30-day rolling retention
- **System health monitoring** with alert thresholds

## Files

| File | Purpose |
|------|---------|
| `setup.sh` | Full Ubuntu slimming + tool/Docker installation |
| `folder-init.sh` | Creates the `/srv/` directory tree for all 8 projects |
| `docker-compose.yml` | PostgreSQL + n8n Docker stack (copy to `/srv/core/`) |
| `schema.sql` | Full PostgreSQL schema with 11 tables, indexes, triggers (copy to `/srv/core/`) |
| `init-db.sh` | One-time database initialisation (creates user, db, loads schema) |
| `backup.sh` | Nightly USB archive script (copy to `/srv/core/`) |
| `health-check.sh` | System health JSON output (copy to `/srv/core/`) |
| `workhorse-stack.service` | systemd unit for auto-start on boot |
| `.env.example` | Environment variable template |
| `n8n-workflows/*.json` | 14 importable n8n workflow definitions |

## Prerequisites

- MacBook Pro running **Ubuntu** (headless, multi-user.target)
- **Docker** and **docker-compose-plugin** installed
- **USB drive** mounted at `/mnt/usb-archive` (for backups)
- SSH access confirmed from your main machine

## Step-by-Step Deployment

### 1. Transfer files to the MacBook

```bash
scp -r ./workhorse-setup/ youruser@<mac-ip>:/home/youruser/workhorse-setup
ssh youruser@<mac-ip>
export SETUP_DIR=~/workhorse-setup
chmod +x "${SETUP_DIR}"/*.sh
```

### 2. Run the setup script

```bash
sudo bash "${SETUP_DIR}/setup.sh"
```

This will:
- Switch boot target to multi-user (headless)
- Remove GNOME desktop, snapd, and unused services
- Install essential tools, UFW, Tailscale, Docker
- Create the full `/srv/` directory tree

### 3. Reboot and reconnect

```bash
sudo reboot
# Wait ~30 seconds, then reconnect via SSH
ssh youruser@<mac-ip>
```

### 4. Authenticate Tailscale

```bash
sudo tailscale up
# Click the auth URL printed. Note your Tailscale IP:
tailscale ip -4
```

### 5. Deploy the Docker stack

```bash
# Copy config files to /srv/core/
cp "${SETUP_DIR}/docker-compose.yml" /srv/core/
cp "${SETUP_DIR}/schema.sql" /srv/core/
cp "${SETUP_DIR}/backup.sh" /srv/core/
cp "${SETUP_DIR}/health-check.sh" /srv/core/
chmod +x /srv/core/*.sh

# Start the stack
cd /srv/core && docker compose up -d

# Wait ~30 seconds for containers to start
sleep 30
docker ps
```

Confirm both `workhorse-postgres` and `workhorse-n8n` are running.

### 6. Initialise the database

```bash
bash "${SETUP_DIR}/init-db.sh"
```

Verify: you should see 11 tables listed and 8 project rows seeded.

### 7. Enable auto-start on boot

```bash
sudo cp "${SETUP_DIR}/workhorse-stack.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable workhorse-stack.service
```

### 8. Mount USB storage (if not already done)

```bash
lsblk                        # Find your USB device (e.g. sdb1)
sudo blkid /dev/sdb1         # Get UUID
# Add to /etc/fstab:
echo "UUID=YOUR-UUID  /mnt/usb-archive  ext4  defaults,nofail  0  2" | sudo tee -a /etc/fstab
sudo mount -a
df -h | grep usb-archive
```

### 9. Access n8n

Open in browser:
```
http://<mac-ip>:5678
# Or via Tailscale:
http://<tailscale-ip>:5678
```

Default login:
- **User:** admin
- **Password:** changeme_n8n (CHANGE THIS)

### 10. Create the "Workhorse DB" credential in n8n

Go to **Settings → Credentials → Add Credential → PostgreSQL**

| Field | Value |
|-------|-------|
| Name | Workhorse DB |
| Host | postgres |
| Port | 5432 |
| Database | workhorse |
| User | workhorse_user |
| Password | changeme_secure |

**Important:** Inside the Docker network, use the service name `postgres` as
the host (not `localhost`). Port is `5432` (the internal port), not `5433`.

### 11. Import the 14 workflow JSONs

Go to **Settings → Import Workflow** (or use the import button on the
workflows page). Import each file from `n8n-workflows/`:

**Daily workflows:**
1. `funding-delta-scan.json` — 06:00 UTC
2. `course-cost-data-pull.json` — 06:30 UTC
3. `sjms-sector-watch.json` — 07:00 UTC
4. `career-consultancy-feed.json` — 07:30 UTC
5. `system-health-check.json` — 05:45 UTC

**Twice-weekly (Tue + Fri):**
6. `future-horizons-market-scan.json` — 07:00 UTC
7. `coursepulse-student-signal.json` — 07:00 UTC
8. `shakespeare-references-refresh.json` — 07:00 UTC

**Weekly (Sunday):**
9. `weekly-funding-digest.json` — 20:00 UTC
10. `weekly-market-digest.json` — 20:00 UTC
11. `weekly-personal-digest.json` — 20:00 UTC
12. `weekly-project-summary.json` — 20:05 UTC

**Maintenance:**
13. `nightly-backup.json` — 02:00 UTC
14. `weekly-db-cleanup.json` — 01:00 UTC Sunday

### 12. Activate workflows

Activate one at a time, starting with:
1. `system-health-check` (verify it runs without errors)
2. `nightly-backup`
3. `funding-delta-scan`
4. Then the rest in any order

## PostgreSQL Connection Details

| Field | Value |
|-------|-------|
| Host | localhost (from Mac) / postgres (from n8n) |
| Port | 5433 (external) / 5432 (internal Docker) |
| Database | workhorse |
| User | workhorse_user |
| Password | changeme_secure |

Connect from the Mac terminal:
```bash
psql -h localhost -p 5433 -U workhorse_user -d workhorse
```

## Passwords to Change

**All of these are in `/srv/core/docker-compose.yml` and must be changed
before production use:**

1. `POSTGRES_PASSWORD` — currently `changeme_secure`
2. `DB_POSTGRESDB_PASSWORD` — must match POSTGRES_PASSWORD
3. `N8N_BASIC_AUTH_PASSWORD` — currently `changeme_n8n`

After changing, restart the stack:
```bash
cd /srv/core && docker compose down && docker compose up -d
```

Also update the "Workhorse DB" credential in n8n with the new password.

## Backup Strategy

- **Daily 02:00:** pg_dump + rsync parsed data + digests to USB
- **Sunday:** Full project archive tar.gz to `/mnt/usb-archive/weekly/`
- **Auto-prune:** Daily backups older than 30 days are deleted
- **Health check:** Alerts if backup is >26 hours old

## 8 Active Projects

| Slug | Name | Priority |
|------|------|----------|
| sjms | SJMS 2.5 / v4 Integrated | 1 (high) |
| mycoursematchmaker | MyCourseMatchmaker | 1 (high) |
| future-horizons | Future Horizons Education | 1 (high) |
| funding-watch | Funding Watch | 1 (high) |
| shakespeare-is-boring | Shakespeare is Boring | 2 (medium) |
| coursepulse | CoursePulse | 2 (medium) |
| film-opps | Film & Script Opportunities | 2 (medium) |
| career-opps | Career & Consultancy Opportunities | 2 (medium) |

## Troubleshooting

```bash
# Check container status
docker ps

# View container logs
docker logs workhorse-postgres
docker logs workhorse-n8n

# Run health check manually
bash /srv/core/health-check.sh | jq .

# Check database connectivity
docker exec workhorse-postgres pg_isready -U postgres

# Restart the stack
cd /srv/core && docker compose down && docker compose up -d

# Revert to graphical desktop (if needed)
sudo systemctl set-default graphical.target && sudo reboot
```
