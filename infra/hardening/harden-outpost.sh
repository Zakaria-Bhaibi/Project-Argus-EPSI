#!/usr/bin/env bash
# Hardening of the Outpost VM (Ubuntu Server 24.04 / Debian 12). Idempotent, run as root:
#   sudo ADMIN_IP=192.168.10.20 ADMIN_USER=argus ./harden-outpost.sh
# Prerequisite: ADMIN_USER already has your SSH public key in ~/.ssh/authorized_keys
# (otherwise you lock yourself out: the script refuses to continue).
set -euo pipefail
ADMIN_IP="${ADMIN_IP:?set ADMIN_IP (the only machine allowed to SSH in)}"
ADMIN_USER="${ADMIN_USER:?set ADMIN_USER}"
TABLE_NET="${TABLE_NET:-192.168.10.0/24}"
[[ $EUID -eq 0 ]] || { echo "run as root"; exit 1; }
[[ -s /home/$ADMIN_USER/.ssh/authorized_keys ]] || { echo "no SSH key for $ADMIN_USER: add one first"; exit 1; }

echo "== packages"
apt-get update -qq
apt-get install -y -qq ufw fail2ban unattended-upgrades auditd apparmor-utils >/dev/null
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "== SSH: keys only, no root, admin user only"
cat > /etc/ssh/sshd_config.d/10-argus.conf <<EOF
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
AllowUsers $ADMIN_USER
MaxAuthTries 3
LoginGraceTime 20
X11Forwarding no
AllowTcpForwarding local
ClientAliveInterval 300
EOF
sshd -t && systemctl reload ssh

echo "== firewall: deny by default, only the ARGUS surface (docs/architecture.md §5.1)"
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow from "$ADMIN_IP" to any port 22 proto tcp comment 'SSH admin only'
ufw allow from "$TABLE_NET" to any port 443 proto tcp comment 'dashboard + API'
ufw allow from "$TABLE_NET" to any port 8883 proto tcp comment 'MQTTS mTLS'
ufw allow 1883/tcp comment 'decoy (fake broker)'
ufw allow 2323/tcp comment 'decoy (fake console)'
ufw logging medium
ufw --force enable

# Docker publishes ports through its own iptables chain and bypasses UFW: restrict it too.
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<EOF
{
  "no-new-privileges": true,
  "icc": false,
  "live-restore": true,
  "userland-proxy": false,
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
if iptables -L DOCKER-USER >/dev/null 2>&1; then
  iptables -F DOCKER-USER
  iptables -A DOCKER-USER -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
  iptables -A DOCKER-USER -p tcp -m multiport --dports 443,8883 ! -s "$TABLE_NET" -j DROP
  iptables -A DOCKER-USER -j RETURN
fi

echo "== fail2ban on SSH"
cat > /etc/fail2ban/jail.d/argus.conf <<EOF
[sshd]
enabled = true
maxretry = 3
bantime = 1h
EOF
systemctl restart fail2ban

echo "== kernel network hardening"
cat > /etc/sysctl.d/90-argus.conf <<EOF
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.icmp_echo_ignore_broadcasts = 1
net.ipv4.tcp_syncookies = 1
net.ipv4.conf.all.log_martians = 1
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
EOF
sysctl --system >/dev/null

echo "== audit: who touches the stack's secrets"
cat > /etc/audit/rules.d/argus.rules <<EOF
-w /etc/ssh/sshd_config.d/ -p wa -k ssh_config
-w /etc/docker/ -p wa -k docker_config
EOF
augenrules --load >/dev/null 2>&1 || true

echo "== disable unused services"
for s in avahi-daemon cups bluetooth; do systemctl disable --now "$s" 2>/dev/null || true; done

echo
echo "done. Restart Docker (systemctl restart docker), then prove it for the report:"
echo "  ufw status verbose ; sshd -T | grep -Ei 'passwordauth|permitroot' ; ss -tlnp"
echo "  from another laptop: nmap -sV -p- 192.168.10.10"
