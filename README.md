# ffmpeg-gui-cloudhub

A secure multi-tenant control plane and reverse tunnel bastion for remote management of `ffmpeg-gui` appliance fleets.

## Overview

`ffmpeg-gui-cloudhub` provides a centralized remote access directory and fleet health monitor without requiring VPNs, public static IPs, or inbound port forwarding on customer routers and firewalls.

## Core Capabilities

- **Zero-Config Reverse Tunnel Bastion**: Edge `ffmpeg-gui` appliances establish persistent outbound WebSocket tunnels to CloudHub, effortlessly traversing strict NAT, CGNAT, and corporate firewalls.
- **Single Sign-On (SSO)**: Authorized operators navigate directly into appliance Web GUIs without entering local appliance passwords.
- **Multi-Tenant Hierarchy & RBAC**: Structured tenant modeling with Organizations, Groups, and Appliances, supporting Superadmins, Org Admins, and Group Operators.
- **Glanceable Vitality Radar**: Real-time LCD-style health monitoring (CPU, RAM, GPU, active streams, degraded services, and update availability).
- **Sysadmin-First Design**: Symmetrical operational model adhering to `ffmpeg-gui` practices (`install.sh`, `update.sh` with warm reload, systemd services, rescue CLI, and automated Let's Encrypt SSL management).

## License

GPLv3 / Apache 2.0 (consistent with the ffmpeg-gui ecosystem).
