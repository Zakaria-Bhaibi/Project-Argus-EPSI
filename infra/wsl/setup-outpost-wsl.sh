#!/usr/bin/env bash
# Sets up the ARGUS Outpost stack inside WSL2 (Ubuntu 24.04). Run INSIDE Ubuntu, as your normal user:
#   bash "/mnt/d/EPSI/Project Argus/infra/wsl/setup-outpost-wsl.sh"
# It asks for your Ubuntu sudo password once. Safe to re-run.
#
# Why copy the repo into ~/argus? Windows drives (/mnt/d) don't support Linux owners/permissions,
# and the stack needs them (mosquitto key owned by uid 1883, api key by uid 10001, chmod 600).
set -euo pipefail
SRC="${SRC:-/mnt/d/EPSI/Project Argus}"
DST="$HOME/argus"

echo "== 1/5 Docker Engine (official repo, not Docker Desktop)"
if ! command -v docker >/dev/null; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq ca-certificates curl rsync openssl python3 >/dev/null
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
fi
sudo apt-get install -y -qq rsync >/dev/null
sudo systemctl enable --now docker >/dev/null
# dev convenience on this laptop only: run docker without sudo (docker group = root-equivalent,
# so the Outpost VM in production keeps sudo-only access; see harden-outpost.sh)
id -nG | grep -qw docker || sudo usermod -aG docker "$USER"

echo "== 2/5 Docker daemon hardening (same settings as harden-outpost.sh)"
sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "no-new-privileges": true,
  "icc": false,
  "live-restore": true,
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
sudo systemctl restart docker

echo "== 3/5 copy the repo (code + PKI output, no node_modules/.venv/.pio)"
mkdir -p "$DST"
rsync -a --delete --exclude node_modules --exclude .venv --exclude .pio --exclude 'services/api/data' \
  --exclude 'infra/runtime' "$SRC/" "$DST/"

echo "== 4/5 runtime secrets and certificate ownership"
cd "$DST/infra"
sudo ./setup-runtime.sh >/dev/null
if [[ "$(sudo cat runtime/secrets/users.json)" == "{}" ]]; then
  echo "Create the first dashboard operator account:"
  read -rp "  username: " U
  until sudo python3 ../services/api/manage_users.py runtime/secrets/users.json "$U" operator; do
    echo "  try again (at least 10 characters)"
  done
fi

echo "== 5/5 build and start the stack (first build: ~5-10 min)"
sudo docker compose up -d --build
sudo docker compose ps
echo
echo "Outpost is up. From Windows: https://localhost (accept the ARGUS CA or the browser warning)."
echo "Re-sync after code changes:  bash \"$SRC/infra/wsl/setup-outpost-wsl.sh\""
