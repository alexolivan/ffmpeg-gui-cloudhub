# Changelog

All notable changes to `ffmpeg-gui-cloudhub` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.4] - 2026-10-29

### Added
- **Public Branding Endpoint (`GET /api/hub/public-branding`):**
  - Added unauthenticated public branding endpoint serving platform hub name, custom logo URL, and login logo text.
  - Dynamically renders configured custom logo image and fallback monogram on the Login screen (`LoginView.tsx`) and updates browser favicon dynamically in document `<head>`.
- **Branded Audit PDF Reports:**
  - Enriched both audit log list reports and single-event forensic certificates with branded visual badges (custom monogram and tenant name / platform owner branding) in `backend/services/audit_pdf_generator.py`.
- **Complete Users CRUD Update (`PUT /api/hub/users/{id}` & `PATCH /api/hub/users/{id}`):**
  - Added user edit modal and action buttons in `UsersTab.tsx` supporting role editing, optional password update, group permissions assignment, and tenant reassignment for platform owners.
- **Complete Groups CRUD Update & Branding:**
  - Added group edit modal in `GroupsTab.tsx` with name modification, monogram/custom logo upload, and tenant reassignment for platform owners.
  - Added drag-and-drop logo upload and monogram badge support for appliance groups.
- **Fleet Appliance Reassignment & Branding in Edit Modal:**
  - Added tenant re-assignment selector (for platform owners) and custom monogram / abbreviation input in Edit Appliance modal in `FleetView.tsx`.
  - Added responsive logo image and monogram badge rendering on `NodeAccessCard.tsx`.

### Changed
- **Fleet Domain Clarification ("Ungrouped" vs "Unassigned"):**
  - Clarified UI terminology: renamed accordion to "Ungrouped Appliances" ("Equipos sin agrupar") to remove conceptual conflict with the "Default" organization tenant.
- **Groups Tab Header Cleanup:**
  - Removed redundant tenant selector dropdown in `GroupsTab.tsx` header, synchronizing group clustering with the persistent global sidebar tenant context.

### Fixed
- **Tenant & Group Image Upload Visual Feedback:**
  - Added visual thumbnail preview in tenant and group edit modals when selecting or dropping an image instead of plain text "✓ Image set".
  - Replaced text `✕` clear button with red trash icon.
- **Appliance Logo/Monogram Broken Image Rendering:**
  - Resolved broken `<img>` rendering when `node.icon_data` contained plain text abbreviations (e.g. `ENC`, `ST1`) rather than image URLs.
- **Favicon Fallback Route Handling:**
  - Fixed `/favicon.ico` / `/favicon.svg` requests returning 404 when originating directly on CloudHub rather than inside an edge proxy session.

## [1.5.3] - 2026-10-29

### Added
- **Tenant Edit Modal & Tenant Branding Management:**
  - Added Edit Tenant action button (`EditIcon`) and modal in `TenantsTab.tsx`, allowing administrators to modify organization names and manage custom branding without having to delete and re-provision tenants.
  - Added support for tenant custom logos (image file uploader / Data URL) and custom monogram abbreviations (2-4 uppercase characters).
  - Dynamically renders tenant brand icons or initials directly inside tenant cards instead of generic placeholder emojis.
- **Tenant-Scoped User Creation in Modal:**
  - Embedded tenant organization selector directly inside the Create User modal for platform owners, defaulting to the currently selected sidebar tenant.
  - Automatically loads and filters group restrictions (`restrictGroups`) according to the active tenant chosen inside the modal.
- **Global User API Endpoints (`GET /api/hub/users` & `POST /api/hub/users`):**
  - Added centralized multi-tenant user endpoints with strict RBAC: platform owners can query and create users across tenants, while tenant admins are strictly confined to their own organization scope.

### Changed
- **Removed Redundant Header Tenant Selector in Users Tab:**
  - Removed the standalone tenant dropdown next to "Create User" button, unifying view filtering with the persistent global sidebar tenant context selector.
- **Restricted Role Creation Permissions:**
  - Removed the `superadmin` role option from the user creation modal; platform owners can only be provisioned via CLI, preventing accidental privilege escalation or misconfigurations.

### Fixed
- **Logo Drag & Drop and Global Drop Shield:**
  - Implemented complete drag-and-drop event pipeline (`dragover`, `dragenter`, `dragleave`, `drop`) on logo upload zones in `GeneralSettingsTab.tsx` with active visual border cues.
  - Added global window drag & drop event interception preventing browsers from hijacking the viewport and rendering dropped PNG/SVG images in full screen.
- **Browser Credential Autocomplete Prevention in Tenant Creation:**
  - Configured `autoComplete="off"` on tenant creation and user creation forms, alongside `autoComplete="new-password"` and isolated non-credential input IDs, preventing browser password managers from auto-filling superuser credentials into new tenant forms.

## [1.5.2] - 2026-10-29

### Added
- **Single-Event Forensic Audit Certificate PDF Generator:**
  - Implemented `AuditSingleEventPdfGenerator` in `backend/services/audit_pdf_generator.py` generating tamper-evident single-page forensic certificates for individual audit entries.
  - Features corporate security header, metadata grid (Actor, Channel, Tenant, Target, Appliance Node, Client IP, Action Classification badge), unclipped multi-line formatted technical payload box, cryptographic SHA-256 integrity seal, issuing authority verification, and legal compliance notice.
  - Added backend endpoint `GET /api/hub/audit-logs/{id}/export-pdf` with strict multi-tenant authorization.
  - Added dedicated "Export Event PDF" action button in `selectedDetailLog` modal and quick "PDF" action icon in each audit log table row in `AuditLogsView.tsx`.
- **Appliance Asset Proxy Referer Fallback (Server-Side Safety Net):**
  - Added resilient server-side fallback endpoints in `backend/main.py` for `/uploads/{subpath}`, `/api/settings/software/{subpath}`, `/api/software/{subpath}`, and `/favicon` variants.
  - Inspects client `Referer` header to detect originating proxied appliance session (`/proxy/{node_id}/`) and issues HTTP 307 Temporary Redirects, preventing SPA router 404s or index.html mis-serving when dynamic assets or background images bypass frontend shims.

### Changed
- **Sidebar Version Area Layout Parity with ffmpeg-gui:**
  - Refactored platform owner version card in `Sidebar.tsx` into 4 clean homogeneous lines: `Environment:`, `Frontend:`, `Backend:` (with update checker `↻` and release pill `▲ v...`), and `Schema:`.
  - Removed awkward nested tags for DB schema, fully matching the layout and typography of `ffmpeg-gui`'s dashboard telemetry card.
- **Enhanced Appliance Reverse Proxy Client-Side JS Shim:**
  - Expanded `JS_SHIM_TEMPLATE` in `backend/core/reverse_proxy.py` to intercept `HTMLImageElement.prototype.src`, `HTMLLinkElement.prototype.href`, and `Element.prototype.setAttribute`.
  - Added dynamic `MutationObserver` on `document.documentElement` to rewrite un-shimmed `/uploads/`, `/api/`, and `/favicon` paths for dynamically rendered React components (e.g. `SoftwareEngineCard`, `EngineLogo`, `SettingsView` custom logo).
  - Extended static HTML string rewriting in `proxy_http_endpoint` to rewrite `/uploads/` and `/favicon` links.

### Fixed
- **Master Audit PDF Report Table Layout:**
  - Replaced truncated technical payload text in the table grid with executive columns: `APPLIANCE` (88pt) and `TARGET` (80pt), keeping total table width at 523pt.
  - Eliminated truncated `details` text clippings from table rows, delegating complete payload analysis to the single-event forensic certificate export.
  - Resolved `node_name` dynamically in `export_audit_pdf` so human appliance labels ("Studio 1", etc.) appear instead of raw fallback IDs.
- **Service Process Updater Mechanism (`update.sh`):**
  - Updated step 5 to use `systemctl restart ffmpeg-gui-cloudhub.service` instead of `systemctl reload-or-restart`.
  - Fixes bug where Uvicorn received SIGHUP (which only reloaded SSL certificates) without restarting the Python interpreter or loading updated module code, causing freshly deployed routes (such as `/export-pdf`) to return 404 until a full restart was executed.
- **SPA Static Asset Protection & Image Fallbacks:**
  - Prevented catch-all SPA router in `serve_spa` from serving `index.html` (HTTP 200) for missing static assets, images, and fonts; returns HTTP 404 JSON, preventing the browser from rendering broken image placeholder frames without console errors.
  - Added seamless `onError` image handlers in `Sidebar.tsx` and `GeneralSettingsTab.tsx` to automatically fall back to the dynamic monogram text badge if an image fails to load.

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
