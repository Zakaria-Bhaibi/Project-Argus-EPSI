#!/usr/bin/env bash
# Prepares infra/runtime/ (gitignored) from the PKI output: secrets + certs with the right owners.
# Run inside the Outpost VM, as root, after copying infra/pki/out/ there (scp over SSH):
#   sudo ./setup-runtime.sh
set -euo pipefail
cd "$(dirname "$0")"
PKI=pki/out
RT=runtime
[[ -f $PKI/ca.crt ]] || { echo "no PKI in $PKI: run pki/pki.sh first (see README)"; exit 1; }
[[ $EUID -eq 0 ]] || { echo "run as root (needs chown)"; exit 1; }

mkdir -p $RT/secrets $RT/mosquitto $RT/api-pki/argus-api $RT/caddy $RT/sim-pki

gen() { [[ -s "$1" ]] || openssl rand -hex 32 > "$1"; }   # keep existing secrets on re-run
gen $RT/secrets/jwt_secret
gen $RT/secrets/db_password
gen $RT/secrets/decoy_token
gen $RT/secrets/vision_token
# the API accepts the decoy and the vision script tokens
paste -sd, $RT/secrets/decoy_token $RT/secrets/vision_token > $RT/secrets/service_tokens
cp $PKI/devices.json $RT/secrets/devices.json
[[ -f $RT/secrets/users.json ]] || echo '{}' > $RT/secrets/users.json

# mosquitto runs as uid 1883
cp $PKI/ca.crt $PKI/ca.crl $PKI/mosquitto/mosquitto.crt $PKI/mosquitto/mosquitto.key $RT/mosquitto/
chown -R 1883:1883 $RT/mosquitto && chmod 600 $RT/mosquitto/mosquitto.key

# api runs as uid 10001
cp $PKI/ca.crt $RT/api-pki/
cp $PKI/argus-api/argus-api.crt $PKI/argus-api/argus-api.key $RT/api-pki/argus-api/
chown -R 10001:10001 $RT/api-pki && chmod 600 $RT/api-pki/argus-api/argus-api.key

# caddy (root in container, all capabilities dropped)
cp $PKI/outpost/outpost.crt $PKI/outpost/outpost.key $RT/caddy/
chmod 600 $RT/caddy/outpost.key

# optional in-VM simulator (uid 10002)
cp $PKI/ca.crt $PKI/devices.json $RT/sim-pki/
for n in sentinel-01 sentinel-02 sentinel-03 sentinel-04; do
  [[ -d $PKI/$n ]] && mkdir -p $RT/sim-pki/$n && cp $PKI/$n/$n.crt $PKI/$n/$n.key $RT/sim-pki/$n/
done
chown -R 10002:10002 $RT/sim-pki && find $RT/sim-pki -name '*.key' -exec chmod 600 {} +

# docker secrets are bind mounts: readable by the container users, nobody else
chmod 644 $RT/secrets/*
chmod 700 $RT/secrets/..
echo "runtime ready. Next:"
echo "  python3 ../services/api/manage_users.py $RT/secrets/users.json <name> operator"
echo "  docker compose up -d --build"
echo "Vision script token: $RT/secrets/vision_token"
