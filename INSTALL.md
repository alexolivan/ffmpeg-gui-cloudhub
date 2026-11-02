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

Clone the repository into your preferred deployment directory (e.g. `/opt/ffmpeg-gui-cloudhub` or `/usr/local/src/ffmpeg-gui-cloudhub`):

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

## 5. SSL / TLS & Web Server Setup

CloudHub can run standalone (handling TLS directly) or behind an existing reverse proxy (such as Nginx).

### Option A: Standalone Let's Encrypt (Certbot)

To secure CloudHub directly with Let's Encrypt:

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

### Option B: Nginx Reverse Proxy (Recommended for Multi-App Hosts)

When running behind Nginx, ensure the WebSocket upgrade headers and streaming timeouts are configured:

```nginx
server {
    listen 80;
    server_name hub.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name hub.example.com;

    ssl_certificate /etc/letsencrypt/live/hub.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/hub.example.com/privkey.pem;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:9000;
        proxy_http_version 1.1;

        # WebSocket support (Critical for /api/edge/tunnel)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Standard proxy headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Disable proxy buffering for low-latency live streams & SSE
        proxy_buffering off;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

---

## 6. Pairing an ffmpeg-gui Appliance

To enroll an edge node into CloudHub:

1. Open CloudHub in your browser and log in as an administrator.
2. Go to **Fleet** -> **Enroll Appliance**.
3. Choose the target tenant (and optional group) and click **Generate Token**.
4. Run the generated command on the edge appliance shell:
   ```bash
   ./bin/ffmpeg-gui-admin enroll-cloudhub https://hub.example.com <ENROLLMENT_TOKEN>
   ```
5. The edge node establishes the reverse tunnel and begins streaming telemetry.

---

## 7. Fail2ban Security Guard

To protect authentication endpoints from brute-force scans:

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

## 8. Service Management & Maintenance

- **Status:** `sudo systemctl status ffmpeg-gui-cloudhub`
- **Start / Stop:** `sudo systemctl start ffmpeg-gui-cloudhub` / `sudo systemctl stop ffmpeg-gui-cloudhub`
- **Live Logs:** `sudo journalctl -u ffmpeg-gui-cloudhub -f`
- **Non-disruptive Updates:**
  ```bash
  cd /opt/ffmpeg-gui-cloudhub
  git pull origin main
  ./update.sh -y
  ```

---

## 9. Offline Admin Rescue CLI

If you lose web access or lock yourself out, run the rescue CLI directly on the server host:

```bash
# Show version and system summary
./bin/ffmpeg-gui-cloudhub-admin show-version

# Reset superadmin password
./bin/ffmpeg-gui-cloudhub-admin reset-admin-password --user admin --password "NewPassword123"

# Create a second emergency superadmin
./bin/ffmpeg-gui-cloudhub-admin create-superadmin --user rescue --password "EmergencySecret456"

# Clear temporary IP lockouts
./bin/ffmpeg-gui-cloudhub-admin unlock-ips
```
