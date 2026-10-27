# Fail2ban Integration for ffmpeg-gui-cloudhub

This directory contains pre-configured Fail2ban filter and jail definitions for `ffmpeg-gui-cloudhub`.

## Quick Setup (Debian / Ubuntu)

1. Copy filter and jail definitions:
   ```bash
   sudo cp packaging/fail2ban/filter.d/ffmpeg-gui-cloudhub.conf /etc/fail2ban/filter.d/
   sudo cp packaging/fail2ban/jail.d/ffmpeg-gui-cloudhub.local /etc/fail2ban/jail.d/
   ```

2. Reload Fail2ban:
   ```bash
   sudo fail2ban-client reload
   ```

3. Check jail status:
   ```bash
   sudo fail2ban-client status ffmpeg-gui-cloudhub
   ```
