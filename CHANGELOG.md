# Changelog

All notable changes to `ffmpeg-gui-cloudhub` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-10-27

### Added
- **Multi-Tenant Hierarchy & RBAC:**
  - Segregation into `Organization` (tenant), `NodeGroup` (operational subdivision), and `EnrolledNode` (edge appliance).
  - Three distinct roles: `superadmin` (global access), `org_admin` (organization tenant manager), and `group_operator` (scoped operator assigned to specific groups).
  - Atomic organization onboarding: creating a tenant automatically sets up its corresponding `org_admin`.
- **Zero-Knowledge SSO Reverse Tunnel Proxy:**
  - Outbound-only reverse WebSocket tunnel (`/api/edge/tunnel`) connecting edge appliances behind NAT / CGNAT to the CloudHub bastion.
  - Ephemeral HMAC-SHA256 assertions (60-second window) for single-sign-on without CloudHub needing to store edge node passwords.
  - In-memory HTTP and WebSocket multiplexing with sub-50ms routing latency.
- **Single-Domain Multi-Tab Isolation:**
  - Client-side `<script>` shim injection dynamically intercepting `fetch`, `WebSocket`, and `XMLHttpRequest` to prefix API calls with `/proxy/{node_id}/`.
  - Cookie isolation rewriting `Set-Cookie` path headers (`Path=/` -> `Path=/proxy/{node_id}/`) to eliminate tab cross-talk on single-domain deployments.
- **Edge Provisioning Ceremony:**
  - Time-limited, single-use enrollment tokens (`ch_enr_...`) for safe appliance pairing.
  - Secure handshake verifying HMAC signatures with unique per-node `tunnel_secret`.
- **Telemetry Radar & Vitality Collector:**
  - Edge heartbeat monitoring (<30s threshold) with live CPU%, RAM%, disk, and service status.
  - Upstream GitHub release radar caching latest versions every 6 hours and flagging outdated nodes.
- **Frontend SPA (Vite + React 19 + Tailwind v4):**
  - Identical design language to `ffmpeg-gui` supporting 5 distinct themes: `studio-dark`, `cyberpunk`, `nordic-frost`, `broadcast-light`, and `warm-paper`.
  - Full internationalization (i18n) parity across English (`en`), Spanish (`es`), and Catalan (`ca`).
- **Sysadmin Operations & Security:**
  - Non-disruptive `install.sh` and `update.sh` automation with `-y` support.
  - Fail2ban filter and jail definitions for brute-force mitigation.
  - Administrative rescue CLI (`bin/ffmpeg-gui-cloudhub-admin`) for offline superadmin password resets.
