#!/usr/bin/env bash
set -euo pipefail

# =============================================================
# WORKHORSE ONE-SHOT DEPLOYMENT
# Run this on the target MacBook terminal as user 'richard'
# =============================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }
info() { echo -e "${CYAN}[INFO]${NC} $1"; }
phase() { echo ""; echo -e "${CYAN}══════════════════════════════════════════${NC}"; echo -e "${CYAN} PHASE $1${NC}"; echo -e "${CYAN}══════════════════════════════════════════${NC}"; echo ""; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOME_DIR="${HOME_DIR:-/home/richard}"
SETUP_DIR="${SETUP_DIR:-${HOME_DIR}/workhorse-setup}"

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  WORKHORSE DEPLOYMENT — MacBook Pro 2013     ║${NC}"
echo -e "${GREEN}║  User: richard | 8 Projects | n8n + Postgres ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""

# -----------------------------------------------------------
phase "0 — PREFLIGHT CHECKS"
# -----------------------------------------------------------

info "Checking we're running as richard..."
if [ "$(whoami)" != "richard" ]; then
  fail "This script must be run as user 'richard'. Current user: $(whoami)"
fi

info "Checking sudo access..."
sudo -v || fail "sudo access required. Run: sudo visudo"

info "Checking internet connectivity..."
if ! ping -c 1 -W 5 github.com > /dev/null 2>&1; then
  fail "No internet connection. Check WiFi with: nmcli connection show --active"
fi
ok "Internet reachable"

info "Checking SSH is enabled..."
sudo systemctl enable ssh 2>/dev/null && sudo systemctl start ssh 2>/dev/null || true
ok "SSH enabled"

info "Current system state:"
echo "  RAM:"; free -h | head -2
echo "  Disk:"; df -h / | tail -1
echo "  IP:"
ip a | grep "inet " | grep -v 127.0.0.1 | awk '{print "  " $2}'
echo ""

# -----------------------------------------------------------
phase "1 — PREPARE LOCAL SETUP FILES"
# -----------------------------------------------------------

if [ ! -f "${SCRIPT_DIR}/docker-compose.yml" ] || [ ! -f "${SCRIPT_DIR}/schema.sql" ]; then
  fail "Required setup files not found beside deploy.sh. Run from the workhorse-setup directory."
fi
ok "Local setup source verified at ${SCRIPT_DIR}"

# Copy setup dir to configured location for consistent downstream paths
if [ -z "${SETUP_DIR}" ] || [ "${SETUP_DIR}" = "/" ] || [ "${SETUP_DIR}" = "${HOME_DIR}" ]; then
  fail "Unsafe SETUP_DIR value: '${SETUP_DIR}'. Refusing to remove."
fi
mkdir -p "${HOME_DIR}"
rm -rf "${SETUP_DIR}"
cp -r "${SCRIPT_DIR}" "${SETUP_DIR}"
chmod +x "${SETUP_DIR}"/*.sh
ok "Setup files ready at ${SETUP_DIR}"

# -----------------------------------------------------------
phase "2 — SWITCH TO HEADLESS BOOT"
# -----------------------------------------------------------

info "Setting boot target to multi-user (headless)..."
sudo systemctl set-default multi-user.target
CURRENT_TARGET=$(systemctl get-default)
if [ "$CURRENT_TARGET" = "multi-user.target" ]; then
  ok "Boot target: multi-user.target"
else
  fail "Could not set boot target. Current: $CURRENT_TARGET"
fi

# -----------------------------------------------------------
phase "3 — REMOVE DESKTOP AND SNAP"
# -----------------------------------------------------------

info "Purging GNOME desktop packages..."
sudo apt purge -y \
  ubuntu-desktop ubuntu-desktop-minimal gnome-shell gnome-session \
  gnome-terminal gnome-control-center gnome-settings-daemon gnome-software \
  gnome-online-accounts ubuntu-wallpapers gdm3 2>/dev/null || true
ok "Desktop packages purged"

info "Cleaning package cache..."
sudo apt autoremove --purge -y 2>/dev/null || true
sudo apt autoclean 2>/dev/null || true
sudo apt clean 2>/dev/null || true
ok "Cache cleaned"

info "Removing snapd..."
sudo systemctl stop snapd 2>/dev/null || true
sudo apt purge -y snapd 2>/dev/null || true
sudo apt autoremove --purge -y 2>/dev/null || true
sudo rm -rf ~/snap /var/snap /var/lib/snapd 2>/dev/null || true
ok "Snapd removed"

info "Disabling unused services..."
for svc in bluetooth cups avahi-daemon ModemManager whoopsie apport; do
  sudo systemctl disable --now "${svc}.service" 2>/dev/null && ok "  Disabled ${svc}" || warn "  ${svc} not found (skip)"
done

echo ""
info "RAM after cleanup:"
free -h | head -2

# -----------------------------------------------------------
phase "4 — INSTALL ESSENTIAL TOOLS"
# -----------------------------------------------------------

info "Updating packages..."
sudo apt update -y && sudo apt upgrade -y

info "Installing tools..."
sudo apt install -y \
  openssh-server git curl wget htop tmux \
  net-tools unzip jq rsync logrotate ufw postgresql-client
ok "Tools installed"

info "Configuring firewall..."
sudo ufw allow ssh
echo "y" | sudo ufw enable 2>/dev/null || true
ok "UFW enabled"

info "Installing Tailscale..."
if ! command -v tailscale &> /dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sh
  ok "Tailscale installed"
else
  ok "Tailscale already installed"
fi

info "Installing Docker..."
if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker richard
  ok "Docker installed"
else
  ok "Docker already installed"
fi
sudo systemctl enable docker && sudo systemctl start docker

info "Installing Docker Compose plugin..."
sudo apt install -y docker-compose-plugin 2>/dev/null || true
ok "Docker Compose ready"

# Ensure docker group is active for this session
if ! groups | grep -q docker; then
  warn "Docker group will take full effect after re-login."
  warn "Using sudo for docker commands in this session."
  DOCKER_CMD="sudo docker"
  COMPOSE_CMD="sudo docker compose"
else
  DOCKER_CMD="docker"
  COMPOSE_CMD="docker compose"
fi

# -----------------------------------------------------------
phase "5 — CREATE FOLDER STRUCTURE"
# -----------------------------------------------------------

info "Creating /srv/ directory tree..."
sudo mkdir -p \
  /srv/projects/sjms/{raw,parsed,reports,exports} \
  /srv/projects/mycoursematchmaker/{raw,parsed,reports,exports} \
  /srv/projects/shakespeare-is-boring/{raw,parsed,reports,exports} \
  /srv/projects/coursepulse/{raw,parsed,reports,exports} \
  /srv/projects/future-horizons/{raw,parsed,reports,exports} \
  /srv/projects/funding-watch/{raw,parsed,reports,exports} \
  /srv/projects/film-opps/{raw,parsed,reports,exports} \
  /srv/projects/career-opps/{raw,parsed,reports,exports} \
  /srv/core/n8n \
  /srv/core/postgres \
  /srv/shared/{notes,exports,digests} \
  /mnt/usb-archive/{daily,weekly,monthly}

sudo chown -R richard:richard /srv
ok "Directory tree created"

# -----------------------------------------------------------
phase "6 — DEPLOY DOCKER STACK"
# -----------------------------------------------------------

info "Copying config files to /srv/core/..."
cp "${SETUP_DIR}/docker-compose.yml" /srv/core/
cp "${SETUP_DIR}/schema.sql" /srv/core/
cp "${SETUP_DIR}/backup.sh" /srv/core/
cp "${SETUP_DIR}/health-check.sh" /srv/core/
chmod +x /srv/core/*.sh
ok "Config files in place"

info "Starting Docker containers..."
cd /srv/core
$COMPOSE_CMD pull
$COMPOSE_CMD up -d
ok "Docker compose started"

info "Waiting 30 seconds for containers to initialise..."
sleep 30

info "Container status:"
$DOCKER_CMD ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Verify both containers are running
if $DOCKER_CMD ps | grep -q "workhorse-postgres" && $DOCKER_CMD ps | grep -q "workhorse-n8n"; then
  ok "Both containers running"
else
  fail "One or both containers failed to start. Check: ${DOCKER_CMD} logs workhorse-postgres"
fi

# -----------------------------------------------------------
phase "7 — INITIALISE DATABASE"
# -----------------------------------------------------------

CONTAINER="workhorse-postgres"

info "Waiting for PostgreSQL to be ready..."
for i in $(seq 1 30); do
  if $DOCKER_CMD exec "$CONTAINER" pg_isready -U postgres > /dev/null 2>&1; then
    ok "PostgreSQL ready (attempt $i)"
    break
  fi
  if [ "$i" -eq 30 ]; then
    fail "PostgreSQL did not become ready after 30 attempts"
  fi
  echo "  Waiting... attempt $i/30"
  sleep 3
done

info "Creating database user..."
$DOCKER_CMD exec "$CONTAINER" psql -U postgres -c \
  "DO \$\$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='workhorse_user') THEN
      CREATE USER workhorse_user WITH PASSWORD 'changeme_secure';
    END IF;
  END \$\$;"
ok "User created"

info "Creating database..."
DB_EXISTS=$($DOCKER_CMD exec "$CONTAINER" psql -U postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname='workhorse'")
if [ "$DB_EXISTS" != "1" ]; then
  $DOCKER_CMD exec "$CONTAINER" psql -U postgres -c \
    "CREATE DATABASE workhorse OWNER postgres ENCODING 'UTF8' TEMPLATE template0;"
  ok "Database created"
else
  ok "Database already exists"
fi

$DOCKER_CMD exec "$CONTAINER" psql -U postgres -c \
  "GRANT ALL PRIVILEGES ON DATABASE workhorse TO workhorse_user;"
$DOCKER_CMD exec "$CONTAINER" psql -U postgres -d workhorse -c \
  "GRANT ALL ON SCHEMA public TO workhorse_user;"

info "Loading schema..."
$DOCKER_CMD cp /srv/core/schema.sql "${CONTAINER}:/tmp/schema.sql"
$DOCKER_CMD exec "$CONTAINER" psql -U postgres -d workhorse -f /tmp/schema.sql
ok "Schema loaded"

info "Verifying tables:"
$DOCKER_CMD exec "$CONTAINER" psql -U postgres -d workhorse -c "\dt"

info "Verifying project seeds:"
$DOCKER_CMD exec "$CONTAINER" psql -U postgres -d workhorse -c \
  "SELECT slug, display_name, priority FROM projects ORDER BY priority, slug;"

# -----------------------------------------------------------
phase "8 — ENABLE AUTO-START AND SYSTEMD"
# -----------------------------------------------------------

info "Installing systemd service..."
sudo cp "${SETUP_DIR}/workhorse-stack.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable workhorse-stack.service
ok "workhorse-stack.service enabled (auto-starts on boot)"

# -----------------------------------------------------------
phase "9 — FINAL HEALTH CHECK"
# -----------------------------------------------------------

info "Running health check..."
bash /srv/core/health-check.sh | jq . 2>/dev/null || bash /srv/core/health-check.sh

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║               DEPLOYMENT COMPLETE                       ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${CYAN}SSH access:${NC}"
echo "  ssh richard@$(hostname -I | awk '{print $1}')"
echo ""
echo -e "${CYAN}n8n UI:${NC}"
echo "  http://$(hostname -I | awk '{print $1}'):5678"
echo "  Login: admin / changeme_n8n"
echo ""
echo -e "${CYAN}PostgreSQL:${NC}"
echo "  Host: localhost  Port: 5433"
echo "  Database: workhorse"
echo "  User: workhorse_user / changeme_secure"
echo ""
echo -e "${RED}PASSWORDS TO CHANGE in /srv/core/docker-compose.yml:${NC}"
echo "  1. POSTGRES_PASSWORD      (currently: changeme_secure)"
echo "  2. DB_POSTGRESDB_PASSWORD (currently: changeme_secure)"
echo "  3. N8N_BASIC_AUTH_PASSWORD (currently: changeme_n8n)"
echo ""
echo -e "${YELLOW}REMAINING MANUAL STEPS:${NC}"
echo ""
echo "  1. Tailscale — run now:"
echo "     sudo tailscale up"
echo "     (Click the auth URL it prints, then note your Tailscale IP)"
echo ""
echo "  2. Change passwords in /srv/core/docker-compose.yml, then:"
echo "     cd /srv/core && docker compose down && docker compose up -d"
echo ""
echo "  3. Open n8n at http://<your-ip>:5678"
echo "     Create credential 'Workhorse DB' (PostgreSQL):"
echo "       Host: postgres | Port: 5432 | DB: workhorse"
echo "       User: workhorse_user | Password: <your new password>"
echo ""
echo "  4. Import all 14 workflow JSONs from:"
echo "     ${SETUP_DIR}/n8n-workflows/"
echo "     (Settings > Import Workflow, one at a time)"
echo ""
echo "  5. Activate workflows starting with: system-health-check"
echo ""
echo "  6. Mount USB drive for backups (if not done):"
echo "     lsblk"
echo "     sudo blkid /dev/sdb1"
echo "     echo 'UUID=YOUR-UUID /mnt/usb-archive ext4 defaults,nofail 0 2' | sudo tee -a /etc/fstab"
echo "     sudo mount -a"
echo ""
echo -e "${GREEN}Done! Your workhorse is running.${NC}"
