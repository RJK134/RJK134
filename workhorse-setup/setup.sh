#!/usr/bin/env bash
set -euo pipefail

# =============================================================
# MacBook Pro 2013 — Ubuntu Headless Workhorse Setup
# For: Richard Knapp — Future Horizons / SJMS / Personal Projects
# =============================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=============================================="
echo " WORKHORSE SETUP — Ubuntu Headless Server"
echo "=============================================="
echo ""

# --- Phase 1: Switch to headless boot ---
echo -e "${YELLOW}--- Phase 1: Switching to multi-user (headless) boot target ---${NC}"
sudo systemctl set-default multi-user.target
CURRENT_TARGET=$(systemctl get-default)
if [ "$CURRENT_TARGET" = "multi-user.target" ]; then
  ok "Boot target set to multi-user.target"
else
  fail "Failed to set boot target. Current: $CURRENT_TARGET"
fi

# --- Phase 2: Remove GNOME desktop and snap ---
echo ""
echo -e "${YELLOW}--- Phase 2: Removing GNOME desktop packages ---${NC}"
sudo apt purge -y \
  ubuntu-desktop ubuntu-desktop-minimal gnome-shell gnome-session \
  gnome-terminal gnome-control-center gnome-settings-daemon gnome-software \
  gnome-online-accounts ubuntu-wallpapers gdm3 2>/dev/null || true
ok "Desktop packages purged"

sudo apt autoremove --purge -y
sudo apt autoclean
sudo apt clean
ok "Package cache cleaned"

echo ""
echo -e "${YELLOW}--- Removing snapd ---${NC}"
sudo systemctl stop snapd 2>/dev/null || true
sudo apt purge -y snapd 2>/dev/null || true
sudo apt autoremove --purge -y
sudo rm -rf ~/snap /var/snap /var/lib/snapd 2>/dev/null || true
ok "Snapd removed"

echo ""
echo -e "${YELLOW}--- Disabling unused services ---${NC}"
for svc in bluetooth cups avahi-daemon ModemManager whoopsie apport; do
  sudo systemctl disable --now "${svc}.service" 2>/dev/null && ok "Disabled ${svc}" || warn "${svc} not found (skipping)"
done

echo ""
echo -e "${GREEN}RAM after cleanup:${NC}"
free -h
echo ""
echo -e "${GREEN}Disk after cleanup:${NC}"
df -h /

# --- Phase 3: Install essential tools ---
echo ""
echo -e "${YELLOW}--- Phase 3: Installing essential tools ---${NC}"
sudo apt update && sudo apt upgrade -y
sudo apt install -y \
  openssh-server git curl wget htop tmux \
  net-tools unzip jq rsync logrotate ufw postgresql-client
ok "Essential tools installed"

echo ""
echo -e "${YELLOW}--- Configuring firewall ---${NC}"
sudo ufw allow ssh
echo "y" | sudo ufw enable
ok "UFW enabled with SSH allowed"

echo ""
echo -e "${YELLOW}--- Installing Tailscale ---${NC}"
curl -fsSL https://tailscale.com/install.sh | sh
ok "Tailscale installed"
warn "Run 'sudo tailscale up' and follow the auth URL after setup completes"

echo ""
echo -e "${YELLOW}--- Installing Docker ---${NC}"
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"
sudo systemctl enable docker && sudo systemctl start docker
ok "Docker installed and enabled"

sudo apt install -y docker-compose-plugin
ok "Docker Compose plugin installed"

# --- Phase 4: Create folder structure ---
echo ""
echo -e "${YELLOW}--- Phase 4: Creating folder structure ---${NC}"
bash "${SCRIPT_DIR}/folder-init.sh"
ok "Folder structure created"

# --- Summary ---
echo ""
echo "=============================================="
echo -e "${GREEN} SETUP COMPLETE${NC}"
echo "=============================================="
echo ""
echo "Next steps:"
echo "  1. Log out and back in (for docker group)"
echo "  2. Run: sudo tailscale up"
echo "     Follow the authentication URL printed"
echo "  3. sudo reboot"
echo "  4. Reconnect via SSH, then:"
echo "     cd /srv/core && docker compose up -d"
echo "  5. Wait 30s, then: bash ~/workhorse-setup/init-db.sh"
echo "  6. Open n8n: http://<your-ip>:5678"
echo ""
echo -e "${RED}IMPORTANT:${NC} Change all default passwords in"
echo "  /srv/core/docker-compose.yml before deploying!"
echo ""
echo -e "${GREEN}Passwords to change:${NC}"
echo "  - POSTGRES_PASSWORD (currently: changeme_secure)"
echo "  - DB_POSTGRESDB_PASSWORD (currently: changeme_secure)"
echo "  - N8N_BASIC_AUTH_PASSWORD (currently: changeme_n8n)"
echo ""
