# Fail2ban Integration for ffmpeg-gui-cloudhub

This directory contains pre-configured Fail2ban filter and jail definitions to protect your `ffmpeg-gui-cloudhub` control plane from brute-force authentication attacks at the Linux kernel firewall level (iptables / nftables).

## How It Works

CloudHub employs a multi-tiered security perimeter:
1. **In-Memory Guard**: Ephemeral lockouts directly in Python memory (`429 Too Many Requests`).
2. **Standardized Security Warnings**: Logged to `cloudhub.log` or systemd journal (`[security] Failed CloudHub login attempt for '<user>' from <IP>`).
3. **W3C / Nginx Access Log**: Logged to `access.log` (`<IP> - - [timestamp] "POST /api/hub/auth/login HTTP/1.1" 401 ...`).
4. **Kernel Firewall Banning (Fail2ban)**: Automatically drops brute-force packets across HTTP and HTTPS ports (`80, 443, 9000, 9443`) before reaching the Python runtime.

---

## Quick Setup (Debian / Ubuntu / Rocky Linux)

1. **Copy filter and jail definitions:**
   ```bash
   sudo cp packaging/fail2ban/filter.d/ffmpeg-gui-cloudhub.conf /etc/fail2ban/filter.d/
   sudo cp packaging/fail2ban/jail.d/ffmpeg-gui-cloudhub.local /etc/fail2ban/jail.d/
   ```

2. **Choose your log source in `/etc/fail2ban/jail.d/ffmpeg-gui-cloudhub.local`:**
   - **Mode 1 (Disk Logs - Recommended):** If your logs live in `/var/log/ffmpeg-gui-cloudhub/` (configured in Settings ➔ Logging), verify the paths under `logpath`.
   - **Mode 2 (Systemd Journal):** If CloudHub runs strictly under systemd with journald logging, uncomment `backend = systemd` and `journalmatch = _SYSTEMD_UNIT=ffmpeg-gui-cloudhub.service`.

3. **Reload Fail2ban:**
   ```bash
   sudo fail2ban-client reload
   ```

4. **Verify active jail status:**
   ```bash
   sudo fail2ban-client status ffmpeg-gui-cloudhub
   ```

---

## Testing Regex Rules

Test matching against your actual log sources before enabling:

- **Against HTTP access.log:**
  ```bash
  sudo fail2ban-regex /var/log/ffmpeg-gui-cloudhub/access.log /etc/fail2ban/filter.d/ffmpeg-gui-cloudhub.conf
  ```

- **Against application cloudhub.log:**
  ```bash
  sudo fail2ban-regex /var/log/ffmpeg-gui-cloudhub/cloudhub.log /etc/fail2ban/filter.d/ffmpeg-gui-cloudhub.conf
  ```

- **Against live systemd journal:**
  ```bash
  journalctl -u ffmpeg-gui-cloudhub.service | sudo fail2ban-regex - /etc/fail2ban/filter.d/ffmpeg-gui-cloudhub.conf
  ```

---

## Unbanning an IP

If an administrative user gets accidentally banned during credential testing:

```bash
sudo fail2ban-client set ffmpeg-gui-cloudhub unbanip <IP_ADDRESS>
```
