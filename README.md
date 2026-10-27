# ffmpeg-gui-cloudhub

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version: 1.0.0](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/alexolivan/ffmpeg-gui-cloudhub)

Central control plane, multi-tenant directory, and zero-knowledge reverse tunnel bastion for [ffmpeg-gui](https://github.com/alexolivan/ffmpeg-gui) appliances.

---

## Overview

In broadcast and field transmission environments, `ffmpeg-gui` appliances often operate behind 4G/5G modems, CGNAT, corporate firewalls, or isolated local networks where opening inbound ports or setting up complex VPN tunnels is impractical or undesirable.

`ffmpeg-gui-cloudhub` solves this by acting as a lightweight, zero-knowledge reverse tunnel bastion. Edge appliances establish a persistent, outbound-only WebSocket connection to CloudHub. Operators can monitor the entire fleet from a single web directory, inspect device health in real time, and access any appliance's full native Web UI with one click—without CloudHub ever storing or handling the edge node's local password.

---

## Key Features

- **Outbound-Only Reverse Tunnels:** Appliances connect outbound to CloudHub over standard HTTPS/WSS (`443/tcp`). Zero port forwarding or firewall punch-through needed on the appliance side.
- **Zero-Knowledge Ephemeral SSO:** CloudHub generates short-lived, cryptographically signed HMAC-SHA256 assertions (60s TTL). Edge appliances validate these locally and grant temporary access without sharing or synchronizing local root passwords.
- **Multi-Tenant Segregation & RBAC:**
  - `superadmin`: Full global control across all organizations and appliances.
  - `org_admin`: Full management of their specific organization's groups, nodes, and operators.
  - `group_operator`: Scoped access strictly to assigned node groups (e.g., Studio 1, Mobile Unit, Transmitter).
- **Single-Domain Multi-Tab Isolation:** Open multiple remote appliance dashboards side-by-side in separate browser tabs under the same CloudHub domain without cookie collisions or path cross-talk.
- **Live Fleet Vitality & Telemetry:** Real-time health statuses (`Online`, `Degraded`, `Offline`), CPU/RAM/Disk metrics, active services/errors count, and upstream version update flags.
- **Unified Look & Feel:** Features the same 5 design themes (`studio-dark`, `cyberpunk`, `nordic-frost`, `broadcast-light`, `warm-paper`) and full internationalization (`en`, `es`, `ca`) as `ffmpeg-gui`.
- **Systemd & Fail2ban Ready:** Includes non-disruptive update scripts, warm reloads, and Fail2ban filters.

---

## Architecture

```
                  ┌─────────────────────────────────────────┐
                  │          ffmpeg-gui-cloudhub            │
                  │   (Reverse Tunnel Bastion / Proxy)      │
                  │       Single Domain / Let's Encrypt     │
                  └───────────────▲─────────────────────────┘
                                  │
                 Multiplexed WSS  │  Outbound Only (Port 443)
                 Reverse Tunnel   │  Zero Port Forwarding
                                  │
     ┌────────────────────────────┼────────────────────────────┐
     │ Behind CGNAT / 4G / NAT    │ Behind Firewall            │ Behind NAT
     ▼                            ▼                            ▼
┌──────────────────┐         ┌──────────────────┐         ┌──────────────────┐
│    Appliance     │         │    Appliance     │         │    Appliance     │
│   (Studio On-Air)│         │   (Transmitter)  │         │   (Mobile OB Van)│
└──────────────────┘         └──────────────────┘         └──────────────────┘
```

---

## Quickstart

### Prerequisites
- Debian 12 or Ubuntu 22.04 / 24.04
- Python 3.10+
- Node.js 18+ and npm

### Installation
```bash
git clone https://github.com/alexolivan/ffmpeg-gui-cloudhub.git
cd ffmpeg-gui-cloudhub
./install.sh -y
```

For detailed deployment instructions, systemd service management, and SSL configuration, see the [Installation Guide](INSTALL.md).

---

## Admin Rescue CLI

An emergency administrative tool is provided for offline password resets and account recovery:

```bash
# Show version info
./bin/ffmpeg-gui-cloudhub-admin show-version

# Reset superadmin password
./bin/ffmpeg-gui-cloudhub-admin reset-admin-password --user admin --password "NewPassword123"

# Create an additional superadmin
./bin/ffmpeg-gui-cloudhub-admin create-superadmin --user rescue_admin --password "SecretPassword456"
```

---

## License

This project is licensed under the [MIT License](LICENSE).
