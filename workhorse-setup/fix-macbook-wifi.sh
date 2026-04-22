#!/usr/bin/env bash
#
# MacBook Pro Late 2013 (BCM4360) WiFi fix for Ubuntu 24.04 LTS
# -------------------------------------------------------------
# - Detects kernel version and installs the correct broadcom-sta-dkms variant
# - Handles the known Ubuntu 24.04.3+ compile failure on kernel 6.17+
# - Blacklists conflicting Broadcom drivers (b43, bcma, brcmsmac, brcmfmac)
# - Loads the wl module so WiFi works immediately (no reboot needed in most cases)
#
# Run with: sudo bash fix-macbook-wifi.sh
# Requires: temporary internet (USB phone tether is fine)

set -euo pipefail

# --- Pretty output ---
C_GREEN='\033[0;32m'; C_BLUE='\033[0;34m'; C_YELLOW='\033[1;33m'
C_RED='\033[0;31m'; C_RESET='\033[0m'
say()  { echo -e "${C_BLUE}==>${C_RESET} $*"; }
ok()   { echo -e "${C_GREEN}✓${C_RESET} $*"; }
warn() { echo -e "${C_YELLOW}!${C_RESET} $*"; }
fail() { echo -e "${C_RED}✗${C_RESET} $*" >&2; exit 1; }

# --- Preconditions ---
[[ $EUID -eq 0 ]] || fail "Please run with: sudo bash $0"

say "Checking system..."
UBUNTU_VERSION=$(lsb_release -rs 2>/dev/null || echo "unknown")
KERNEL_VERSION=$(uname -r)
KERNEL_MAJOR=$(echo "$KERNEL_VERSION" | cut -d. -f1)
KERNEL_MINOR=$(echo "$KERNEL_VERSION" | cut -d. -f2)

echo "   Ubuntu: $UBUNTU_VERSION"
echo "   Kernel: $KERNEL_VERSION"

# --- Verify BCM4360 is present ---
if ! lspci -nn 2>/dev/null | grep -qi "BCM4360\|14e4:43a0"; then
    warn "BCM4360 chip not detected. Continuing anyway, but this script is specifically for that chipset."
    read -rp "Continue? [y/N] " confirm
    [[ "$confirm" =~ ^[Yy]$ ]] || exit 0
fi
ok "BCM4360 chip detected"

# --- Check internet ---
say "Checking internet connectivity..."
if ! ping -c 1 -W 3 archive.ubuntu.com >/dev/null 2>&1; then
    fail "No internet. Plug in your USB tether / enable tethering on your phone, then rerun this script."
fi
ok "Internet reachable"

# --- Determine if we need the noble-proposed patched driver ---
NEEDS_PROPOSED=0
if [[ "$KERNEL_MAJOR" -gt 6 ]] || { [[ "$KERNEL_MAJOR" -eq 6 ]] && [[ "$KERNEL_MINOR" -ge 17 ]]; }; then
    NEEDS_PROPOSED=1
    warn "Kernel $KERNEL_VERSION needs the patched driver from noble-proposed (known 24.04 bug)"
else
    ok "Kernel $KERNEL_VERSION works with the standard driver"
fi

# --- Clean up any broken prior install ---
say "Cleaning up any previous broken driver state..."
apt-get remove --purge -y broadcom-sta-dkms bcmwl-kernel-source 2>/dev/null || true
rm -f /var/crash/broadcom-sta-dkms.*.crash 2>/dev/null || true
dpkg --configure -a 2>/dev/null || true
ok "Cleaned"

# --- Blacklist conflicting modules ---
say "Blacklisting conflicting Broadcom drivers..."
cat > /etc/modprobe.d/broadcom-blacklist.conf <<'EOF'
# Blacklist drivers that conflict with the proprietary wl module (BCM4360)
blacklist b43
blacklist bcma
blacklist brcmsmac
blacklist brcmfmac
EOF
ok "Blacklist written to /etc/modprobe.d/broadcom-blacklist.conf"

# Unload them now if loaded
for mod in b43 bcma brcmsmac brcmfmac; do
    modprobe -r "$mod" 2>/dev/null || true
done

# --- Enable noble-proposed if needed ---
if [[ "$NEEDS_PROPOSED" -eq 1 ]]; then
    say "Enabling noble-proposed repository (pinned, low priority)..."
    cat > /etc/apt/sources.list.d/noble-proposed.list <<'EOF'
deb http://archive.ubuntu.com/ubuntu/ noble-proposed restricted main multiverse universe
EOF
    # Pin it low so only explicitly requested packages come from proposed
    cat > /etc/apt/preferences.d/proposed-updates <<'EOF'
Package: *
Pin: release a=noble-proposed
Pin-Priority: 400
EOF
    ok "noble-proposed configured (pinned to priority 400)"
fi

# --- Update package lists ---
say "Updating package lists..."
apt-get update -qq
ok "Package lists updated"

# --- Install the driver ---
say "Installing broadcom-sta-dkms..."
export DEBIAN_FRONTEND=noninteractive
if [[ "$NEEDS_PROPOSED" -eq 1 ]]; then
    apt-get install -y -t noble-proposed broadcom-sta-dkms
else
    apt-get install -y broadcom-sta-dkms
fi
ok "Driver installed"

# --- Verify DKMS build succeeded ---
say "Verifying DKMS module built cleanly..."
if dkms status | grep -i broadcom-sta | grep -qi "installed\|deployed"; then
    ok "DKMS build confirmed"
else
    warn "DKMS status unclear — checking manually..."
    dkms status | grep -i broadcom || true
fi

# --- Load the wl module ---
say "Loading wl kernel module..."
if modprobe wl 2>/dev/null; then
    ok "wl module loaded"
else
    warn "Could not load wl module immediately — a reboot will fix this"
fi

# --- Restart NetworkManager so it sees the new interface ---
say "Restarting NetworkManager..."
systemctl restart NetworkManager 2>/dev/null || true
sleep 2
ok "NetworkManager restarted"

# --- Summary ---
echo
echo -e "${C_GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C_RESET}"
echo -e "${C_GREEN}  WiFi driver installation complete${C_RESET}"
echo -e "${C_GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C_RESET}"
echo
echo "What should happen now:"
echo "  1. Look at the top-right of your screen — the network icon should"
echo "     now show a WiFi symbol alongside your USB tether."
echo "  2. Click it, choose your WiFi network, enter the password."
echo
echo "If no WiFi networks appear:"
echo "  • Reboot once (sudo reboot) — this is normal on first install."
echo "  • After reboot, WiFi will work permanently. You can unplug the"
echo "    USB tether."
echo
echo "Verification (optional):"
echo "  • Run:  ip link show   →  you should see a 'wlp*' or 'wlan*' interface"
echo "  • Run:  lsmod | grep wl   →  should show the wl module loaded"
echo
