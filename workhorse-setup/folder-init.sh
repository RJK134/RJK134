#!/usr/bin/env bash
set -euo pipefail

# =============================================================
# Create the full workhorse directory tree
# =============================================================

echo "Creating workhorse directory tree..."

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

sudo chown -R "$USER":"$USER" /srv

echo ""
echo "Directory tree created:"
echo ""
echo "/srv/"
echo "├── projects/"
echo "│   ├── sjms/{raw,parsed,reports,exports}"
echo "│   ├── mycoursematchmaker/{raw,parsed,reports,exports}"
echo "│   ├── shakespeare-is-boring/{raw,parsed,reports,exports}"
echo "│   ├── coursepulse/{raw,parsed,reports,exports}"
echo "│   ├── future-horizons/{raw,parsed,reports,exports}"
echo "│   ├── funding-watch/{raw,parsed,reports,exports}"
echo "│   ├── film-opps/{raw,parsed,reports,exports}"
echo "│   └── career-opps/{raw,parsed,reports,exports}"
echo "├── core/"
echo "│   ├── n8n/"
echo "│   └── postgres/"
echo "└── shared/"
echo "    ├── notes/"
echo "    ├── exports/"
echo "    └── digests/"
echo ""
echo "/mnt/usb-archive/"
echo "├── daily/"
echo "├── weekly/"
echo "└── monthly/"
echo ""
echo "All directories owned by $USER"
