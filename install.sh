#!/usr/bin/env bash
set -e

# =========================================================================
# ffmpeg-gui-cloudhub - Installer
# =========================================================================

PROJ_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSUME_YES=false

show_help() {
    echo "Usage: $0 [-y | --yes]"
    echo "  -y, --yes: Run non-interactively assuming 'yes' to prompts"
}

while [[ "$#" -gt 0 ]]; do
    case $1 in
        -y|--yes) ASSUME_YES=true; shift ;;
        -h|--help) show_help; exit 0 ;;
        *) echo "Unknown parameter: $1"; show_help; exit 1 ;;
    esac
done

echo "================================================================="
echo "            FFMPEG-GUI CLOUDHUB INSTALLER                       "
echo "================================================================="
echo "Target Directory: ${PROJ_DIR}"
echo "================================================================="

if [ "$ASSUME_YES" = false ]; then
    read -r -p "Proceed with CloudHub installation? [y/N]: " confirm || confirm="n"
    if [[ ! "$confirm" =~ ^[yY]([eE][sS])?$ ]]; then
        echo "Installation aborted by user."
        exit 0
    fi
fi

# 1. Check Python and Node prerequisites
command -v python3 >/dev/null 2>&1 || { echo "Error: python3 is required."; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Error: node is required."; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "Error: npm is required."; exit 1; }

# 2. Setup Python virtual environment
echo "[1/4] Setting up Python virtual environment..."
if [ ! -d "${PROJ_DIR}/venv" ]; then
    python3 -m venv "${PROJ_DIR}/venv"
fi

"${PROJ_DIR}/venv/bin/pip" install --upgrade pip
"${PROJ_DIR}/venv/bin/pip" install -r "${PROJ_DIR}/backend/requirements.txt"

# 3. Compile Frontend SPA
echo "[2/4] Building Frontend SPA..."
cd "${PROJ_DIR}/frontend"
if [ ! -d "node_modules" ]; then
    npm install
fi
npm run build
cd "${PROJ_DIR}"

# 4. Initialize Database & Seed Superadmin
echo "[3/4] Initializing Database & Permissions..."
"${PROJ_DIR}/bin/ffmpeg-gui-cloudhub-admin" init-db

# 5. Optional Systemd Unit Installation
echo "[4/4] Configuring Systemd Service..."
SERVICE_FILE="/etc/systemd/system/ffmpeg-gui-cloudhub.service"
CURRENT_USER="$(id -un)"

cat << EOF > /tmp/ffmpeg-gui-cloudhub.service
[Unit]
Description=ffmpeg-gui-cloudhub control plane & reverse tunnel bastion
After=network.target

[Service]
Type=simple
User=${CURRENT_USER}
WorkingDirectory=${PROJ_DIR}
ExecStart=${PROJ_DIR}/venv/bin/python3 -m backend.run_server
ExecReload=/bin/kill -HUP \$MAINPID
Restart=always
RestartSec=3
KillMode=process

[Install]
WantedBy=multi-user.target
EOF

if [ "$EUID" -eq 0 ]; then
    cp /tmp/ffmpeg-gui-cloudhub.service "${SERVICE_FILE}"
    systemctl daemon-reload
    systemctl enable ffmpeg-gui-cloudhub.service
    echo "[+] Installed systemd unit at ${SERVICE_FILE}"
elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    sudo cp /tmp/ffmpeg-gui-cloudhub.service "${SERVICE_FILE}"
    sudo systemctl daemon-reload
    sudo systemctl enable ffmpeg-gui-cloudhub.service
    echo "[+] Installed systemd unit via sudo at ${SERVICE_FILE}"
else
    echo "[*] Systemd unit created at /tmp/ffmpeg-gui-cloudhub.service"
    echo "    To install manually: sudo cp /tmp/ffmpeg-gui-cloudhub.service ${SERVICE_FILE} && sudo systemctl daemon-reload"
fi

echo "================================================================="
echo " Installation Complete!"
echo " Start CloudHub manually: ${PROJ_DIR}/venv/bin/python3 -m backend.run_server"
echo " Or via systemd: sudo systemctl start ffmpeg-gui-cloudhub"
echo " Web UI: http://localhost:8000"
echo "================================================================="
