# Changelog

All notable changes to `ffmpeg-gui-cloudhub` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.1] - 2026-10-29

### Fixed
- **Audit Logs Date Filtering & Local Timezone Calculation:**
  - Resolved date preset bug in `AuditLogsView.tsx` where `.toISOString().slice(0, 10)` converted local midnight into UTC of previous day in positive UTC offsets (e.g. CET/CEST), incorrectly leaking yesterday's events into the "Today" filter.
  - Implemented local calendar formatter `formatLocalDate` ensuring single-day presets (`today`) and multi-day presets (`7d`, `30d`) accurately scope to the user's active local day.
  - Ensured API serialization formats `AuditLog.timestamp` with explicit UTC ISO designator (`Z`) for consistent browser parsing via `toLocaleString()`.
- **Operator Remote Session Auditing (Connect & Disconnect):**
  - Added operational audit event `NODE_SESSION_START` upon SSO URL generation (`/api/hub/nodes/{node_id}/sso-url`), capturing operator username, target appliance ID, and client IP.
  - Added operational audit event `NODE_SESSION_END` upon remote session termination / logout (`/proxy/{node_id}/logout` and `/api/auth/logout`), properly completing the session lifecycle audit trail.
- **Server Logging Persistence & Uvicorn Configuration (`cloudhub.log`):**
  - Resolved root logger level issue in `setup_cloudhub_logging` where default Python `WARNING` level prevented all `logger.info()` messages from being written to `cloudhub.log`.
  - Configured propagation and explicit log level inheritance on `"cloudhub"`, `"uvicorn"`, and `"uvicorn.error"` loggers.
  - Resolved Uvicorn logging overwrite in `backend/run_server.py` by supplying `log_config=None` to `uvicorn.Config` and loading DB settings on startup and warm reload cycles, preventing Uvicorn from destroying the rotating file handler.
  - Synchronized `backend/main.py` lifespan to initialize logging handlers from DB configuration on server startup.

## [1.5.0] - 2026-10-28

### Added
- **Platform Owner Version Panel & Environment Card (Parity with ffmpeg-gui):**
  - Positioned in Sidebar directly beneath Logo area and above Tenant Context Controller.
  - Role-gated strictly to Platform Owner (`superadmin`), hidden for tenant administrators and operators.
  - Live environment detection: distinguishes `🟢 Production` (main/master/release tags) from development branches `🟣 {branch} ({commit})` with short git hash.
  - Integrated `update_checker.py` performing non-blocking cached checks against upstream GitHub releases/tags with SemVer comparison.
  - Real-time update notification badge (`▲ v{latest}`) linking to release notes, and interactive manual update refresh button (`↻`) with spin animation.
  - Responsive layout: compact version pill in collapsed sidebar (`w-20`) and full card with DB schema version (`DB v1.0.0`) in expanded view (`lg:w-64`).
- **Audit Logs Date Range Filtering & Time Interval Scoping:**
  - Added query parameters (`start_date`, `end_date`, `org_id`, `channel`, `search`) to `GET /api/hub/audit-logs`.
  - Frontend interactive date range selector with quick presets (*All Time*, *Today*, *Last 24 Hours*, *Last 7 Days*, *Last 30 Days*, *Custom Range...*) and dual HTML5 date pickers.
- **Pure-Python Corporate Audit PDF Report Generator & Downloader:**
  - Built zero-dependency PDF 1.4 report generation engine in `backend/services/audit_pdf_generator.py`.
  - Added `GET /api/hub/audit-logs/export-pdf` endpoint delivering paginated compliance reports with official corporate header, metadata block (tenant, date range, node), executive summary KPI metrics (total events, security events, distinct operators, appliances), alternating row styling, and running footers (*Page X of Y*).
  - Floating `EXPORT PDF REPORT` button on `AuditLogsView.tsx` with instant browser file download.
- **Multi-language Localization (i18n):**
  - Added all version, update status, date range presets, and PDF export translation keys to `en.json` (Single Source of Truth), `es.json`, and `ca.json`.

## [1.4.0] - 2026-10-28

### Added
- **Multi-Tenant Backup & Restore System (Export/Validate/Import):**
  - Strict RBAC-enforced configuration export and import: platform owner (`superadmin`) can export the entire platform (`scope="full"`) or scope down to any individual tenant (`scope="tenant"`). Tenant administrators (`org_admin` / `tenant_admin`) are strictly isolated to exporting and restoring records within their assigned organization.
  - Granular selection of configuration sections to export: platform system settings (branding, networking, logging), appliance groups, enrolled appliances (nodes), and user accounts.
  - Safe import pre-validation (`POST /api/hub/backup/validate`): verifies `ffmpeg-gui-cloudhub` application signature, schema version, permission boundaries, and returns real-time entity count breakdown. Rejects full platform backups when uploaded by tenant administrators with clear UI feedback.
  - Atomic database restoration (`POST /api/hub/backup/import`) merging missing records without destructive overwrite of existing database identifiers.
  - Dedicated `BackupRestoreTab.tsx` in Settings with metadata preview badge grid, target tenant selector for superadmins, warning alerts, and confirmation modal.
- **W3C Access Logging & Fail2ban Security Hardening (Parity with ffmpeg-gui):**
  - Added `AccessLogMiddleware` logging HTTP requests in standard Nginx Combined / W3C format (`%h %l %u %t "%r" %>s %b "%{Referer}i" "%{User-Agent}i"`), with real client IP resolution from `X-Forwarded-For` and `X-Real-IP`, and noise filtering for static web assets.
  - Copytruncate gzipped rotation (`access.log.1.gz` ... `access.log.5.gz`) automated in `MaintenanceScheduler`.
  - Updated Fail2ban filter (`packaging/fail2ban/filter.d/ffmpeg-gui-cloudhub.conf`) with dual regex matching both Python warning logs in systemd journald and HTTP 401/429 login brute-force attempts in `access.log`.
  - Updated Fail2ban jail (`packaging/fail2ban/jail.d/ffmpeg-gui-cloudhub.local`) with ports `80,443,9000,9443` and dual backend log monitoring.
- **Multi-language Localization (i18n):**
  - Added all backup, export, validation, and restore translation keys to `en.json` (Single Source of Truth), `es.json`, and `ca.json`.

## [1.3.0] - 2026-10-28

### Added
- **Authentication & Owner Credentials Card (Parity with ffmpeg-gui):**
  - Dedicated card with red badge indicator for owner credentials and authentication management.
  - Added `PUT /api/hub/auth/owner-profile` endpoint allowing the platform owner (superadmin) to rename their username from the default `admin` to any custom handle and/or change their password with required current password validation.
  - Automatically re-issues authenticated session cookies and generates security audit trail entries upon credential modifications.
- **Branding & Platform Identity Card (Parity with ffmpeg-gui):**
  - 1:1 design matching `ffmpeg-gui` with platform name, customizable logo monogram abbreviation (up to 4 chars), and interactive drag-and-drop / click-to-upload image box.
  - Added `POST /api/hub/settings/logo` endpoint with automatic 256x256 thumbnailing and RGBA normalization via Pillow, unauthenticated public serve endpoint `GET /api/hub/settings/logo/file`, and deletion endpoint `DELETE /api/hub/settings/logo` with immediate monogram fallback.
- **Logging Configuration Card & Filesystem Probe (Parity with ffmpeg-gui):**
  - Configurable logging modes (`journalctl`, `file`, `both`), timestamp formats (`utc` / `local`), and gzipped log file rotation with customizable max bytes and backup archives.
  - Added `POST /api/hub/settings/logging/test-path` endpoint with dynamic filesystem write-permission probing to validate user-defined log directory or file paths prior to committing changes.
- **Multi-language Localization (i18n):**
  - Added all security, branding, and logging translation keys to `en.json` (Single Source of Truth), `es.json`, and `ca.json`.

## [1.2.0] - 2026-10-28

### Added
- **UI/UX Parity with ffmpeg-gui Appliance:**
  - Modern lateral Sidebar navigation (`w-20 lg:w-64`) with brand logo, Fleet, Audit Log, role-gated Settings, user profile indicator, clean logout, and embedded Tenant Context Controller.
  - Removed top persistent header bar; main canvas directly occupies the screen with natural horizontal expansion (`p-6 lg:p-8`), eliminating restrictive maximum-width constraints.
  - Page titles and descriptions positioned at top-left with contextual action controls floating at top-right on each view.
  - Integrated Tenant Context Controller into the lateral Sidebar between the logo area and navigation items, cleanly separating the compact dropdown selector from the active tenant badge indicator.
  - Relocated Interface Language and Interface Theme controls to Settings -> General as dedicated cards matching the 1:1 design and color swatches of `ffmpeg-gui`.
  - Consolidated `FleetView` with top 4 KPI cards (Total Appliances, Online, Offline/Degraded, Active Groups), free-text/status filter bar, and collapsible `GroupAccordionSection` with quick-enroll modal.
  - Sticky-header `AuditLogsView` with business filter bar (Tenant, Node, Origin, Category, free-text search, limit) and modal JSON payload inspector.
  - Tabbed `SettingsView` with RBAC gating: General Branding & Maintenance, Network & SSL, Tenants (Owner only), Appliance Groups, and User Accounts.
- **Network Binding, Dual-Port HTTP/HTTPS & Autonomous Let's Encrypt ACME Engine:**
  - Ported `network_inspector.py` and `NetworkInterfaceSelector` from `ffmpeg-gui` with host interface discovery (`0.0.0.0`, `127.0.0.1`, or specific host IP with fail-safe lockout protection).
  - Dual-server `uvicorn` runtime in `run_server.py` supporting concurrent HTTP (`http_port`, default `9000`) and HTTPS (`https_port`, default `9443`) listeners on a unified `asyncio` event loop with `SIGHUP` warm reload.
  - Explicit `ssl_enabled` and `force_https_redirect` (`307 Temporary Redirect` from `http_port` to `https_port`) controls gated by active certificate validity.
  - Pure-Python ACME v2 HTTP-01 challenge engine (`acme` + `josepy`) with temporary TCP port 80 listener: Dry-Run (Staging) mode validates domain & port 80 reachability without installing untrusted staging certificates to disk.
  - Custom certificate upload endpoints supporting standard PEM certificate chain and private key files.
  - Live certificate health monitoring with remaining days countdown, issuer inspection, and warning badges.
- **Background Maintenance & Gzipped Log Rotation:**
  - `GzippedRotatingFileHandler` compressing rotated server logs (`.1.gz` ... `.5.gz`) automatically.
  - `MaintenanceScheduler` background worker performing unattended ACME certificate auto-renewal (when `<= 30` days remain) and audit log retention pruning.

### Fixed
- **Let's Encrypt Staging UI Mode Preservation:** Prevented `ssl_mode` from resetting to `disabled` upon staging validation completion, keeping the ACME configuration card open with positive validation feedback.
- **FQDN Redirect & SSL Certificate Domain Matching:** In `force_https_middleware`, requests arriving via raw IP or localhost are redirected to the configured `hub_domain`, preventing browser `ERR_CERT_COMMON_NAME_INVALID` warnings. Added explicit UI guidance and 1-click domain launcher.
- **HTTPS Port Fallback Resilience:** Added persistent fallback self-signed certificate generation so the HTTPS listener remains alive on `https_port` during certificate updates or deletions, avoiding abrupt connection drops and browser `Failed to fetch` errors.

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
