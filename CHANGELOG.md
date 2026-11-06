# Changelog

All notable changes to `ffmpeg-gui-cloudhub` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
