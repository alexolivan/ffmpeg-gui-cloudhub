# Changelog

All notable changes to `ffmpeg-gui-cloudhub` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-10-28

### Added
- **UI/UX Parity with ffmpeg-gui Appliance:**
  - Modern lateral Sidebar navigation (`w-20 lg:w-64`) with brand logo, Fleet, Audit Log, and role-gated Settings, plus user profile indicator and clean logout.
  - Top Header with active view title, Owner Tenant Context Switcher (with tenant badge, name, and node counter), static tenant badge for operators, theme picker (5 themes), and language selector (`en`, `es`, `ca`).
  - Consolidated `FleetView` with top 4 KPI cards (Total Appliances, Online, Offline/Degraded, Active Groups), free-text/status filter bar, and collapsible `GroupAccordionSection` with quick-enroll modal.
  - Sticky-header `AuditLogsView` with business filter bar (Tenant, Node, Origin, Category, free-text search, limit) and modal JSON payload inspector.
  - Tabbed `SettingsView` with RBAC gating: General Branding & Maintenance, Network & SSL, Tenants (Owner only), Appliance Groups, and User Accounts.
- **Autonomous Let's Encrypt ACME Engine & Custom SSL:**
  - Pure-Python ACME v2 HTTP-01 challenge engine with temporary TCP port 80 listener.
  - Custom certificate upload endpoints supporting standard PEM certificate chain and private key.
  - Live certificate health monitoring with remaining days countdown, issuer inspection, and warning badges.
- **Background Maintenance & Gzipped Log Rotation:**
  - `GzippedRotatingFileHandler` compressing rotated server logs (`.1.gz` ... `.5.gz`) automatically.
  - `MaintenanceScheduler` background worker performing unattended ACME certificate auto-renewal (when `<= 30` days remain) and audit log retention pruning.

## [1.1.0] - 2026-10-27

### Added
- **Edge Node Audit Event Tunnel Relay:**
  - Multiplexed tunnel frame support for `TunnelMessageType.AUDIT_EVENT`.
  - Automatic ingestion and persistence of edge appliance operational audit events into CloudHub's central `audit_logs` database table.
  - Multi-tenant edge node attribution via `node_id` and origin channel classification (`cloudhub`, `local_gui`, `cli`).
- **Audit Logs View Enhancements:**
  - Added edge node selector filter (`All Nodes & Hub`, `CloudHub Central`, or specific edge node).
  - Added Node / Origin badge column and Channel pill indicators (`☁️ CloudHub`, `🖥️ Local GUI`, `⌨️ CLI`).
- **Database Resilience:**
  - Dynamic backward-compatible schema migration in `init_db()` auto-adding `node_id` and `channel` columns to existing SQLite tables.

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
