#!/usr/bin/env bash
set -e

# =========================================================================
# ffmpeg-gui-cloudhub - Updater
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
echo "            FFMPEG-GUI CLOUDHUB UPDATER                         "
echo "================================================================="
echo "Target Directory: ${PROJ_DIR}"
echo "================================================================="

if [ "$ASSUME_YES" = false ]; then
    read -r -p "Proceed with CloudHub update? [y/N]: " confirm || confirm="n"
    if [[ ! "$confirm" =~ ^[yY]([eE][sS])?$ ]]; then
        echo "Update aborted by user."
        exit 0
    fi
fi

# 1. Update git repository if git exists
if [ -d "${PROJ_DIR}/.git" ] && command -v git >/dev/null 2>&1; then
    echo "[1/4] Pulling latest git updates..."
    git -C "${PROJ_DIR}" pull --ff-only || {
        echo "Warning: git pull failed or repository has local changes. Continuing update."
    }
fi

# 2. Update Python dependencies
echo "[2/4] Updating backend Python dependencies..."
if [ -d "${PROJ_DIR}/venv" ]; then
    "${PROJ_DIR}/venv/bin/pip" install -r "${PROJ_DIR}/backend/requirements.txt"
fi

# 3. Build frontend bundle
echo "[3/4] Checking and building frontend SPA..."
cd "${PROJ_DIR}/frontend"
npm run build
cd "${PROJ_DIR}"

# 4. Migrate database schema if needed
echo "[4/4] Synchronizing database schema..."
"${PROJ_DIR}/bin/ffmpeg-gui-cloudhub-admin" init-db

# 5. Reload systemd service without connection loss
if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet ffmpeg-gui-cloudhub.service 2>/dev/null; then
    echo "[*] Reloading active ffmpeg-gui-cloudhub systemd service..."
    if [ "$EUID" -eq 0 ]; then
        systemctl reload-or-restart ffmpeg-gui-cloudhub.service
    elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
        sudo systemctl reload-or-restart ffmpeg-gui-cloudhub.service
    fi
fi

echo "================================================================="
echo " CloudHub Update Finished Successfully!"
echo "================================================================="
