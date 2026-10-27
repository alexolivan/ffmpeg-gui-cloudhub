# Installation Guide for ffmpeg-gui-cloudhub

This guide explains how to install and run `ffmpeg-gui-cloudhub` on a Debian or Ubuntu server to serve as a central reverse tunnel bastion and telemetry directory for remote `ffmpeg-gui` appliances.

---

## 1. System Requirements

- **Operating System:** Debian 12 (Bookworm) or Ubuntu 22.04 / 24.04 LTS
- **Python:** Python 3.10 or newer (with `python3-venv` and `python3-pip`)
- **Node.js:** Node.js 18+ and `npm` (for compiling the frontend bundle)
- **Network:** 
  - Inbound port `80/tcp` (HTTP / Let's Encrypt ACME challenges)
  - Inbound port `443/tcp` (HTTPS / WSS reverse tunnels and Web UI)
- **Domain:** A public FQDN pointing to your server (e.g., `hub.example.com`). Wildcard DNS is **not** required.

---

## 2. Install System Packages

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip nodejs npm git curl fail2ban
```

---

## 3. Clone Repository and Install

Clone the repository into your preferred deployment directory (e.g. `/opt/ffmpeg-gui-cloudhub`):

```bash
sudo git clone https://github.com/alexolivan/ffmpeg-gui-cloudhub.git /opt/ffmpeg-gui-cloudhub
sudo chown -R $USER:$USER /opt/ffmpeg-gui-cloudhub
cd /opt/ffmpeg-gui-cloudhub
```

Run the automated installer:

```bash
./install.sh -y
```

The script will:
1. Create a Python virtual environment in `venv/`.
2. Install Python backend dependencies.
3. Build the frontend SPA bundle in `frontend/dist/`.
4. Initialize the SQLite database (`cloudhub.db`) and bootstrap the initial superadmin user.
5. Create and enable the systemd service `ffmpeg-gui-cloudhub.service`.

---

## 4. Initial Superadmin Credentials

Upon database initialization, the default superadmin account is created:
- **Username:** `admin`
- **Default Password:** `cloudhubadmin`

> [!IMPORTANT]
> Immediately change the superadmin password using the emergency CLI or via the Web UI:
> ```bash
> ./bin/ffmpeg-gui-cloudhub-admin reset-admin-password --user admin --password "YourStrongPasswordHere"
> ```

---

## 5. SSL / TLS Certificate Setup

### Automated Let's Encrypt (Certbot)

To secure CloudHub with a trusted Let's Encrypt certificate:

```bash
sudo apt install -y certbot
sudo certbot certonly --standalone -d hub.example.com
```

Link the generated certificates into CloudHub's certificate directory:

```bash
mkdir -p data/certs/live
sudo ln -sf /etc/letsencrypt/live/hub.example.com/fullchain.pem data/certs/live/fullchain.pem
sudo ln -sf /etc/letsencrypt/live/hub.example.com/privkey.pem data/certs/live/privkey.pem
```

Restart or reload the service:

```bash
sudo systemctl reload-or-restart ffmpeg-gui-cloudhub.service
```

---

## 6. Fail2ban Security Guard

To protect the login endpoint from brute-force attempts at the OS level:

```bash
sudo cp packaging/fail2ban/filter.d/ffmpeg-gui-cloudhub.conf /etc/fail2ban/filter.d/
sudo cp packaging/fail2ban/jail.d/ffmpeg-gui-cloudhub.local /etc/fail2ban/jail.d/
sudo systemctl restart fail2ban
```

Verify jail status:

```bash
sudo fail2ban-client status ffmpeg-gui-cloudhub
```

---

## 7. Service Management

- **Status:** `sudo systemctl status ffmpeg-gui-cloudhub`
- **Start / Stop:** `sudo systemctl start ffmpeg-gui-cloudhub` / `sudo systemctl stop ffmpeg-gui-cloudhub`
- **Live Logs:** `sudo journalctl -u ffmpeg-gui-cloudhub -f`
- **Non-disruptive update:** `./update.sh -y`
