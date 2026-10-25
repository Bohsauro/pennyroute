#!/usr/bin/env bash
# PennyRoute — one-command installer
#   wget -qO- https://raw.githubusercontent.com/Bohsauro/pennyroute/main/install.sh | bash
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
say() { printf "${GREEN}%s${NC}\n" "$1"; }
warn() { printf "${YELLOW}%s${NC}\n" "$1"; }
die() { printf "${RED}%s${NC}\n" "$1" >&2; exit 1; }

PORT="${PENNY_PORT:-8490}"
INSTALL_DIR="${PENNY_INSTALL_DIR:-$HOME/pennyroute}"
SERVICE_NAME="pennyroute"

say "◆ PennyRoute installer"
say "  dir : $INSTALL_DIR"
say "  port: $PORT"

# 0) deps
command -v python3 >/dev/null || die "python3 required (>=3.10)"
command -v git >/dev/null || die "git required"
python3 - <<'PY' || die "python3 >= 3.10 required"
import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)
PY
say "  ✓ python3 $(python3 --version | awk '{print $2}')"

# 1) code
if [ -d "$INSTALL_DIR/.git" ]; then
  say "  ✓ already cloned, pulling latest…"
  git -C "$INSTALL_DIR" pull --ff-only -q || warn "  pull failed, using local copy"
else
  git clone -q --depth 1 https://github.com/Bohsauro/pennyroute.git "$INSTALL_DIR" \
    || die "clone failed"
  say "  ✓ cloned"
fi

# 2) venv + deps
cd "$INSTALL_DIR"
if [ ! -d .venv ]; then
  python3 -m venv .venv
  say "  ✓ venv created"
fi
./.venv/bin/pip install -q --upgrade pip >/dev/null 2>&1 || true
./.venv/bin/pip install -q -r requirements.txt
say "  ✓ dependencies installed"

# 3) OpenRouter key: env > ~/.hermes/.env > prompt
if [ -z "${OPENROUTER_API_KEY:-}" ] && [ ! -f ~/.hermes/.env ] && [ ! -f .env ]; then
  warn "  OpenRouter key not found."
  read -r -p "  Paste your OpenRouter API key (sk-or-...): " ORKEY
  [ -n "$ORKEY" ] || die "no key provided"
  printf 'OPENROUTER_API_KEY=%s\n' "$ORKEY" > .env
  say "  ✓ saved to .env (chmod 600)"
  chmod 600 .env
fi

# 4) systemd service if systemd available
if command -v systemctl >/dev/null 2>&1 && [ "$(id -u)" -eq 0 ]; then
  UNIT="/etc/systemd/system/${SERVICE_NAME}.service"
  cat > "$UNIT" <<UNIT
[Unit]
Description=PennyRoute — the frugal AI router
After=network.target

[Service]
Type=simple
User=${SUDO_USER:-root}
WorkingDirectory=$INSTALL_DIR
ExecStart=$INSTALL_DIR/.venv/bin/python -m uvicorn pennyroute.app:app --host 0.0.0.0 --port $PORT
Restart=always
RestartSec=3
EnvironmentFile=-$INSTALL_DIR/.env

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable --now "${SERVICE_NAME}" >/dev/null 2>&1
  say "  ✓ systemd service enabled (${SERVICE_NAME})"
  IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  say "◆ PennyRoute is LIVE"
  say "  Dashboard : http://${IP:-localhost}:${PORT}/"
  say "  API       : http://${IP:-localhost}:${PORT}/v1"
  say "  Logs      : journalctl -u ${SERVICE_NAME} -f"
else
  warn "  systemd not available — run manually:"
  echo "    cd $INSTALL_DIR && ./.venv/bin/python -m uvicorn pennyroute.app:app --host 0.0.0.0 --port $PORT"
  say "◆ installed. Start it with the command above."
fi