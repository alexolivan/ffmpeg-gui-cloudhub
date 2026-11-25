# Changelog

All notable changes to `ffmpeg-gui-cloudhub` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.0] - 2026-11-25

### Added
- **Flexible Operator Appliance Access Scope (`backend/database/`, `auth_manager.py`, `tenant_routes.py`, `backup_routes.py`, `UsersTab.tsx`, `NodePermissionsModal.tsx`)**:
  - Added `all_groups_access` and `include_ungrouped` boolean flags to `User` (`DB_SCHEMA_VERSION = "1.2.0"` with idempotent `ALTER TABLE` migrations and backup export/import support, defaulting to `False` for full backwards compatibility).
  - Replaced the single group checklist in Create/Edit Operator modals with a mutually exclusive 2-mode selector (**All Tenant Appliances** vs **Specific Groups** with an independent **Include Ungrouped Appliances** checkbox). Tenants without groups default to **All Tenant Appliances** so small single-appliance stations no longer need dummy groups.
  - Updated `AuthManager.can_user_access_node`, operator scope badges in `UsersTab`, and operator reachability in `NodePermissionsModal` to honor both flags consistently.
- **Tenant-Grouped Superadmin Fleet View (`frontend/src/components/views/FleetView.tsx`)**:
  - Grouped **All Tenants** Fleet view hierarchically by Tenant (tenant header with logo/monogram, slug, and online/degraded/offline counts) so groups sharing names across tenants (e.g., `Default`) and ungrouped appliances are clearly isolated per organization.
  - Rendered appliance cards directly without redundant group accordions when a tenant defines no groups.

## [1.4.8] - 2026-11-25

### Fixed
- **Instant Virtual LCD Font Rendering & Offline Proxy Icon Guard (`frontend/vite.config.ts`, `backend/routers/tenant_routes.py`)**:
  - Raised Vite `build.assetsInlineLimit` to `8192` bytes so `DSEG14Classic-Bold.woff2` (5.9 KB) is inlined directly as a data URI inside the stylesheet, eliminating FOIT blank virtual LCD panels without flashing fallback characters (`~`/`!`).
  - Updated `GET /api/hub/nodes` to skip returning `/proxy/{node_id}/...` icon URLs for `offline` or `unlinked` appliances (falling back to cached `logo_text` / initials), preventing unreachable tunnel icon fetches from stalling browser HTTP/1.1 connection slots.

## [1.4.7] - 2026-11-23

### Fixed
- **Live Sidebar Tenant Switcher Refresh (`frontend/src/App.tsx`, `SettingsView.tsx`, `TenantsTab.tsx`, `BackupRestoreTab.tsx`)**:
  - Propagated `onTenantsUpdated` / `onBackupRestored` callbacks from `SettingsView` (`fetchAppData`) to `TenantsTab` and `BackupRestoreTab` so creating, editing, deleting, or restoring tenants refreshes the superadmin Sidebar tenant selector immediately without relogging or reloading the page, and clears `selectedOrgId` if the active tenant is deleted.

## [1.4.6] - 2026-11-23

### Fixed
- **First Tenant Visibility & `id === 1` Assumption on Fresh Installs (`backend/routers/tenant_routes.py`, `frontend/src/components/Sidebar.tsx`, `FleetView.tsx`, `TenantsTab.tsx`, `UsersTab.tsx`, `GroupsTab.tsx`)**:
  - Identified the virtual `Default` organization strictly by `slug === 'default'` instead of `id === 1`. On clean databases where `init_db()` does not seed a virtual `default` organization, the first real tenant created by the superadmin receives `id = 1` and was previously hidden across **Tenants & Orgs**, **Users & RBAC**, **Appliance Groups**, the **Sidebar** tenant switcher, and **Fleet** modals.

## [1.4.5] - 2026-11-19

### Fixed
- **Cosmetic UI & Multi-Theme Polish (`frontend/src/components/modals/NodePermissionsModal.tsx`, `frontend/src/index.css`, `frontend/src/locales/{en,es,ca}.json`)**:
  - Moved the sticky **Services / Scheduled Tasks** column header row inside the scrollable container (`sticky top-0` with matching `border border-transparent px-3`) so column headers stay pixel-aligned with the table rows regardless of vertical scrollbar width.
  - Updated `rbac.domains.hardware` to `Hardware & I/O` (`Hardware & E/S` / `Maquinari & E/S`) for parity with `ffmpeg-gui` and removed `ID` from search placeholders in `NodePermissionsModal`.
  - Styled `input:-webkit-autofill` using CSS theme tokens (`var(--text-primary)`) so browser password autofill respects dark themes cleanly.

## [1.4.4] - 2026-11-18

### Changed
- **4-Column Service/Task Table Layout in Appliance Permissions (`frontend/src/components/modals/NodePermissionsModal.tsx`)**:
  - Moved service and task type badges into a dedicated 2nd fixed-width column (`120px`) between **Service / Scheduled Task** and **Computed Access**, keeping left edges of all titles cleanly aligned across rows and widened modal container (`max-w-5xl`).

## [1.4.3] - 2026-11-18

### Changed
- **Appliance Permissions Table & Symmetric Selector UX (`frontend/src/components/modals/NodePermissionsModal.tsx`)**:
  - Made switching between **Team / Policy Template** and **Individual Operator Exception** fully symmetric by resetting the inactive dropdown to its prompt option when switching scope.
  - Pinned search/filter controls and fixed-width 3-column table headers (**Service / Scheduled Task**, **Computed Access**, **Override**) outside the scrollable list so layouts remain stable across appliances.
  - Matched Edge service card type badges and row tint accents (`FFmpeg`, `MediaMTX`, `Icecast`, `Web Kiosk`, `Desktop`, `PipeWire`, and scheduled tasks) and showed alias + full service/task name without `#id` noise.
  - Computed effective access reactively per subject, only elevating dependencies via `Auto-Monitor` (`via <consumer>`) when at least one consumer service has effective access `>= monitor`.

## [1.4.2] - 2026-11-18

### Changed
- **Appliance Permissions Modal UX (`frontend/src/components/modals/NodePermissionsModal.tsx`, `backend/core/permissions_compiler.py`, `backend/routers/permissions_routes.py`)**:
  - Replaced ambiguous mode buttons with side-by-side **Team / Policy Template** and **Individual Operator Exception** selectors featuring migrating focus borders (`brand-lime` vs `cyan`), contextual banners, and dynamic Save CTA labels.
  - Listed operators without access to the appliance's group as disabled/greyed options while keeping them visible.
  - Split permissions into 3 context-separated tabs (**Modules & Types**, **Services**, **Scheduled Tasks**) eliminating nested scrolling, with search and override-only filters on Services/Tasks.
  - Exposed live inherited baseline values (`inherited_preview`, `subject_teams`, and `override_counts` in `GET /api/hub/nodes/{node_id}/permissions`) so every selector displays the exact inherited level and origin alongside one-click reset to inherited.

## [1.4.1] - 2026-11-18

### Added
- **Tunnel Lifecycle Audit Logging (`backend/core/tunnel_server.py`, `backend/routers/edge_routes.py`, `frontend/src/components/views/AuditLogsView.tsx`)**:
  - Persisted `NODE_ONLINE` and `NODE_OFFLINE` events to `AuditLog` with tenant `org_id`, `node_id`, `channel="cloudhub"`, client IP, and session duration (excluding duplicate/superseded socket replacements and voluntary unlink/revoke transitions), with green/red action badges in Audit Log.

### Fixed
- **Teams & Default Operators Tenant Selector UX (`frontend/src/components/views/settings/TeamsTab.tsx`, `backend/routers/tenant_routes.py`)**:
  - Excluded the virtual `Default` system organization from **Settings → Teams** so superadmins no longer land on an empty virtual `Default Operators` template; when multiple tenants exist and no global tenant filter is selected, prompts the superadmin to choose a tenant locally without mutating the global Fleet filter, while auto-selecting when only a single tenant exists.
  - Updated `PUT/PATCH /api/hub/users/{user_id}` to enroll teamless `group_operator` users into their tenant's `Default Operators` template on save and prune `TeamMember` rows when promoted to `org_admin` or reassigned to another organization.

## [1.4.0] - 2026-11-18

### Added
- **RBAC Teams & Fine-Grained Edge Authorization Claims (`backend/database/`, `backend/core/permissions_compiler.py`, `backend/core/reverse_proxy.py`, `backend/core/tunnel_server.py`, `backend/routers/permissions_routes.py`)**:
  - Added `Team`, `TeamMember`, and `NodePermissionOverride` models (`DB_SCHEMA_VERSION = "1.1.0"`) with automatic default conservative operator team initialization per organization.
  - Added HMAC-SHA256 signed `authz_assertion` forwarding across HTTP, streaming HTTP, and WebSocket tunnel frames when `group_operator` users access enrolled edge nodes supporting `authz_claims`, with HTTP `426` / WebSocket `4003` legacy node guards for restricted accounts.
  - Added `/api/hub/orgs/{org_id}/teams`, `/api/hub/teams/{team_id}`, `/api/hub/nodes/{node_id}/permissions`, `/api/hub/nodes/{node_id}/catalog`, and orphan rule purge endpoints.
- **CloudHub Teams & Appliance Permissions UI (`frontend/src/components/views/settings/TeamsTab.tsx`, `frontend/src/components/modals/NodePermissionsModal.tsx`)**:
  - Added the **Teams & Permissions** tab in CloudHub Settings (`superadmin` / `org_admin`) to manage domain/process capability templates and operator memberships.
  - Added the **Appliance Permissions** modal in Fleet View displaying live edge service/task catalogs, dependency-derived `Auto-Monitor` hints, orphaned override cleanup, and team/user override matrices.

## [1.3.1] - 2026-11-17

### Fixed
- **CSS & Single-Quoted Asset URL Rewriting in Reverse Proxy (`backend/core/reverse_proxy.py`)**:
  - Added `text/css` `url(/...)` rewriting and inline HTML `<style>` `url(...)` / single-quoted attribute rewriting (`href`/`src`/`action`) under `/proxy/{node_id}/` so legacy Icecast 2.4 stylesheets (`style.css` referencing `/icecast.png`, `/corner_topright.jpg`, `/corner_bottomright.jpg`, `/tunein.png`) resolve through the node proxy without 404 errors.

## [1.3.0] - 2026-11-17

### Added
- **Chunked HTTP Streaming over Reverse Tunnel (`backend/core/tunnel_protocol.py`, `tunnel_server.py`, `reverse_proxy.py`)**:
  - Extended the multiplexed reverse tunnel protocol with `http_resp_start`, `http_resp_chunk`, `http_resp_end`, and `http_req_cancel` frames while preserving 100% backwards compatibility with monolithic `http_resp` responses.
  - Enabled `StreamingResponse` pass-through in `proxy_http_endpoint` for live Icecast audio mountpoints (`audio/*`, `application/ogg`), MJPEG multipart video previews, and chunked binary streams, automatically cancelling the upstream edge stream on client disconnect.
  - Added `action="/api/` rewriting in the reverse proxy HTML rewriter.

## [1.2.1] - 2026-11-17

### Fixed
- **Reverse Tunnel Reconnection Race Condition (`backend/core/tunnel_server.py`, `backend/routers/edge_routes.py`)**:
  - Added tunnel instance identity verification (`expected_tunnel` / `source_tunnel`) in `unregister_tunnel` and `handle_tunnel_message`. When an edge appliance reconnects rapidly after WAN flapping while a half-open socket is still tearing down on the server, the late `finally:` block of the superseded socket can no longer evict the newly registered active tunnel or falsely mark the node offline.
  - Moved superseded WebSocket closure outside `TunnelServer._lock` with a 2s timeout so stalled half-open sockets cannot block tunnel registrations.
  - Handled `RuntimeError` / `WebSocketDisconnect` cleanly when forwarding `WS_FRAME` payloads to an already-closed browser WebSocket, preventing noisy ASGI tracebacks and notifying the edge node to close the stream.

## [1.2.0] - 2026-11-06

### Added
- **Crystalfontz CFA635-TMF Virtual LCD Bezel & Remote Rack Locator (`frontend/backend`)**:
  - Implemented an authentic Crystalfontz CFA635-TMF negative blue transmissive LCD bezel with high-contrast white text, side bezel housing, and 4 vertical status micro-LEDs directly on the 1U rack faceplate.
  - Added real-time edge LCD telemetry ingestion (`enabled`, `connected`, `alias`, `model`, `locator_active`) into CloudHub telemetry collector.
  - Added remote rack locator proxy endpoint `POST /api/hub/nodes/{node_id}/lcd-locator` tunneling commands directly to the appliance hardware.
  - Interactive "FIND / LOC" button in CloudHub: clicking it causes both the virtual UI visor and the physical rack LCD to cycle flashing LEDs and alternate find-me text at 2Hz.
- **Multi-Tab Session Termination & WebSocket Kill-Switch (`backend/frontend`)**:
  - Injected `BroadcastChannel('cloudhub_auth')` and `storage` event listeners into the reverse proxy HTML shim so that logging out of CloudHub instantly terminates and redirects open edge appliance browser tabs.
  - Added user ID tracking across reverse proxy WebSocket bridges (`active_ws_users`), actively terminating all open edge WebSocket streams for that operator on `/api/hub/auth/logout`.

### Changed
- **Zero-Jitter 1U Rack Grid Alignment (`frontend`)**:
  - Re-architected 1U rack chassis strip into strict fixed-width faceplate zones (`w-[17.5rem]` identity/LCD slot, `w-[8.5rem]` Node ID, `w-[4.5rem]` version, `w-[5.25rem]` CPU, `w-[5.25rem]` RAM, `w-[7rem]` Uptime, `w-[7.5rem]` Services, `w-24` Status Badge, `w-28` Launch Button, `w-14` Manage Actions).
  - Telemetry digits use fixed-width character spans and `tabular-nums`, preventing horizontal shifting when status badges or telemetry figures change.

## [1.1.0] - 2026-11-05

### Added
- **High-Density Fleet Dashboard & 1U Rack Chassis View (`frontend`)**:
  - Compacted global layout canvas padding and vertical spacing (`space-y-3`), drastically increasing usable screen real estate on 1080p displays.
  - Re-architected top KPI metric cards into an inline horizontal layout, displaying icons, labels, and figures in ~60px height without sacrificing aesthetic clarity.
  - Streamlined filter bar by eliminating redundant action buttons and tightening inputs.
  - Transformed appliance cards into a full-width 1U Rack Chassis matrix format (`NodeAccessCard` in `space-y-1.5` stacks), with distinct status LED borders, inline technical metadata, and tabular monospace telemetry (`CPU`, `RAM`, `Uptime`, `Services`) aligned with `ffmpeg-gui` and `ffmpeg-gui-scanner`.

## [1.0.1] - 2026-11-03

### Fixed
- **WebSocket Reverse Proxy ES6 Proxy & Binary Subprotocol Negotiation (`backend/core/reverse_proxy.py`)**:
  - Replaced the monkey-patched `window.WebSocket` constructor in the JS Shim with an ES6 `Proxy`. This preserves constructor metadata and static properties (`WebSocket.OPEN = 1`, `CONNECTING`, `CLOSING`, `CLOSED`), unblocking noVNC/RFB WebSocket clients from freezing during handshake negotiation.
  - Added explicit `binary` subprotocol negotiation support in `proxy_websocket_endpoint`.

## [1.0.0] - 2026-11-02

### Added
- **Reverse Tunnel Bastion & WebSocket Multiplexing**:
  - Outbound-only TLS reverse tunnel connection (`/api/edge/tunnel`) from `ffmpeg-gui` appliances over HTTPS/WSS (port 443).
  - Traverses cellular 4G/5G, CGNAT, and corporate firewalls without inbound port forwarding or firewall punch-through.
  - Dual handshake authentication supporting HTTP headers (`X-Node-ID`, `X-Tunnel-Timestamp`, `X-Tunnel-Signature`) and query parameter fallback for proxy/CDN resilience.
- **Zero-Knowledge Ephemeral Single Sign-On (SSO)**:
  - Ephemeral HMAC-SHA256 signed assertions (60s TTL) generated on the fly using node-specific tunnel secrets.
  - Validated locally on edge appliances to grant direct, single-click access to native web dashboards.
  - Zero storage or handling of edge node local root passwords on CloudHub.
  - Multi-tab isolation under a single domain via scoped cookie namespacing and path rewrites.
- **Real-Time Fleet Vitality & Upstream Release Intelligence**:
  - Continuous telemetry streaming every 5s (CPU, RAM, disk usage, uptime, active daemon services, error counts).
  - Instant status detection (`Online`, `Degraded`, `Offline`) with visual indicator cards and group accordions.
  - Automated GitHub release tag polling for remote appliance firmware/software update notifications.
- **Multi-Tenant Governance & Granular RBAC**:
  - Three-tier authorization hierarchy: Platform Superadmin (Owner), Tenant Administrator, and Group Operator.
  - Strict UNIX-style tenant seed prefixes (`[slug]_user`) preventing cross-tenant username collisions while preserving friendly suffixes.
  - Cascade renaming on tenant seed updates with collision pre-validation and individual audit logging.
  - Role-based view filtering with seamless tenant switcher for platform owners.
- **Centralized Operational & Security Audit Logging**:
  - Comprehensive audit trail of authentications, failed login attempts for valid users, appliance enrollments, configuration backups, and edge session proxy activity.
  - Multi-criteria filtering console (actor, appliance, origin, category, date range).
  - Branded PDF compliance reports rendered via ReportLab with platform monogram headers and filter summaries.
- **Symmetric Node Revocation & Voluntary Unlink Protocol**:
  - Central node deletion actively sends a `REVOKE` control frame and closes the tunnel with code `4004`, causing the remote appliance to instantly clear its credentials and cease reconnection loops.
  - Listens for `UNLINK_NOTIFY` frames when appliances are unlinked by their hardware owner, recording a dedicated `NODE_UNLINKED_LOCALLY` audit trail event.
- **White-Label Customization, Themes & Multi-Language**:
  - Custom branding support (logo image uploads in PNG/SVG/WebP or monogram text fallbacks for platform and tenants).
  - 5 responsive visual themes (`Studio Dark`, `Cyberpunk Neon`, `Nordic Frost`, `Broadcast Light`, `Warm Paper`).
  - Full internationalization (English, Spanish, Catalan) with instant in-app switching.
- **Encapsulated Data Architecture & Auto-Migration**:
  - Encapsulated runtime storage under `data/` (`data/cloudhub.db`, `data/certs/`, `data/uploads/`, `data/logs/`), keeping repository root clean.
  - Seamless auto-migration of legacy database files from project root to `data/`.
- **System Administration & Rescue Tooling**:
  - Emergency offline CLI (`bin/ffmpeg-gui-cloudhub-admin`) for password resets, brute-force lockout clearing, and superadmin provisioning.
  - Automated non-disruptive installation (`install.sh`) and update (`update.sh`) scripts.
  - Fail2ban security jail filters for host-level brute-force protection.
- **Official Documentation & Screenshot Suite**:
  - Screenshot gallery in `docs/assets/` illustrating Fleet Directory, Audit Trails, and System Settings.
  - Production-ready `README.md` and `INSTALL.md` with systemd and Nginx reverse proxy configurations.
