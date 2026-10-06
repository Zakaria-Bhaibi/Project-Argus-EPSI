#!/usr/bin/env bash
# ARGUS private PKI (OpenSSL). Everything is written to infra/pki/out/ (gitignored).
#
#   ./pki.sh init                          create the CA
#   ./pki.sh server <name> <san,san,...>   server cert   e.g. server mosquitto DNS:outpost,IP:192.168.10.10
#   ./pki.sh client <cn>                   client cert   e.g. client argus-api
#   ./pki.sh device <node-id>              node cert + HMAC key + firmware secrets header
#   ./pki.sh revoke <name>                 revoke a cert and regenerate the CRL
#   ./pki.sh crl                           regenerate the CRL
#   ./pki.sh bootstrap                     the whole standard PKI (CA + all ARGUS certs)
set -euo pipefail
export MSYS2_ARG_CONV_EXCL="/O="   # Git Bash on Windows: do not mangle "/O=..." subjects

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"
OUT="out"   # relative on purpose: works with native Windows openssl too
CA_DAYS=825
LEAF_DAYS=365
# Least privilege for the CA itself: even if ca.key leaks, the CA can only vouch for ARGUS names,
# never for e.g. a bank's website (matters because we import ca.crt into the Windows trust store).
# Non-critical on purpose: mbedTLS (ESP32) rejects unknown *critical* extensions; Windows and
# browsers enforce name constraints either way.
NAME_CONSTRAINTS="permitted;DNS:localhost,permitted;DNS:outpost,permitted;DNS:mosquitto,permitted;DNS:host.wokwi.internal,permitted;IP:192.168.10.0/255.255.255.0,permitted;IP:127.0.0.0/255.0.0.0"
STD_SERVER_SANS="DNS:outpost,DNS:localhost,IP:192.168.10.10,IP:127.0.0.1"
# first python that actually runs (on Windows "python3" can be a Store stub)
PY="$(for p in python3 python; do "$p" -c "" 2>/dev/null && { echo "$p"; break; }; done)"

write_ca_conf() {
  cat > "$OUT/ca.cnf" <<EOF
[ ca ]
default_ca = argus_ca
[ argus_ca ]
dir               = .
database          = \$dir/index.txt
new_certs_dir     = \$dir/newcerts
serial            = \$dir/serial
crlnumber         = \$dir/crlnumber
certificate       = \$dir/ca.crt
private_key       = \$dir/ca.key
default_md        = sha256
default_crl_days  = 30
policy            = policy_any
copy_extensions   = copy
unique_subject    = no
[ policy_any ]
commonName        = supplied
[ server_ext ]
basicConstraints  = critical,CA:FALSE
keyUsage          = critical,digitalSignature
extendedKeyUsage  = serverAuth
[ client_ext ]
basicConstraints  = critical,CA:FALSE
keyUsage          = critical,digitalSignature
extendedKeyUsage  = clientAuth
EOF
}

need_ca() { [[ -f "$OUT/ca.crt" ]] || { echo "No CA, run: $0 init" >&2; exit 1; }; }

sign() {  # sign <name> <ext> [san]
  local name="$1" ext="$2" san="${3:-}"
  local dir="$OUT/$name"; mkdir -p "$dir"
  openssl ecparam -name prime256v1 -genkey -noout -out "$dir/$name.key"
  chmod 600 "$dir/$name.key"
  local addext=()
  [[ -n "$san" ]] && addext=(-addext "subjectAltName=$san")
  openssl req -new -key "$dir/$name.key" -subj "/O=AetherCorp/OU=ARGUS/CN=$name" "${addext[@]}" -out "$dir/$name.csr"
  (cd "$OUT" && openssl ca -batch -config ca.cnf -extensions "$ext" -days "$LEAF_DAYS" \
    -in "$name/$name.csr" -out "$name/$name.crt" -notext 2>/dev/null)
  rm "$dir/$name.csr"
  cp "$OUT/ca.crt" "$dir/ca.crt"
  echo "issued $dir/$name.crt"
}

gen_crl() {
  (cd "$OUT" && openssl ca -batch -config ca.cnf -gencrl -out ca.crl 2>/dev/null)
  echo "CRL written to $OUT/ca.crl"
}

cmd="${1:-}"; shift || true
case "$cmd" in
  init)
    [[ -f "$OUT/ca.crt" ]] && { echo "CA already exists in $OUT" >&2; exit 1; }
    mkdir -p "$OUT/newcerts"; : > "$OUT/index.txt"; echo 1000 > "$OUT/serial"; echo 1000 > "$OUT/crlnumber"
    write_ca_conf
    openssl ecparam -name prime256v1 -genkey -noout -out "$OUT/ca.key"; chmod 600 "$OUT/ca.key"
    openssl req -x509 -new -key "$OUT/ca.key" -sha256 -days "$CA_DAYS" \
      -subj "/O=AetherCorp/OU=ARGUS/CN=ARGUS Root CA" \
      -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
      -addext "keyUsage=critical,keyCertSign,cRLSign"       -addext "nameConstraints=$NAME_CONSTRAINTS" -out "$OUT/ca.crt"
    echo '{}' > "$OUT/devices.json"
    gen_crl
    echo "CA created: $OUT/ca.crt"
    ;;
  server)
    need_ca; [[ $# -eq 2 ]] || { echo "usage: $0 server <name> <san,san>" >&2; exit 1; }
    sign "$1" server_ext "$2"
    ;;
  client)
    need_ca; [[ $# -eq 1 ]] || { echo "usage: $0 client <cn>" >&2; exit 1; }
    sign "$1" client_ext
    ;;
  device)
    need_ca; [[ $# -eq 1 ]] || { echo "usage: $0 device <node-id>" >&2; exit 1; }
    id="$1"
    [[ "$id" =~ ^[a-z0-9-]{3,32}$ ]] || { echo "node id must match [a-z0-9-]{3,32}" >&2; exit 1; }
    sign "$id" client_ext
    key_hex="$(openssl rand -hex 32)"
    echo -n "$key_hex" > "$OUT/$id/$id.hmac"; chmod 600 "$OUT/$id/$id.hmac"
    "$PY" - "$OUT/devices.json" "$id" "$key_hex" <<'PY'
import json, sys
path, node, key = sys.argv[1:4]
reg = json.load(open(path))
reg[node] = {"hmac_key": key}
json.dump(reg, open(path, "w"), indent=2)
PY
    "$HERE/firmware-secrets.sh" "$id"
    ;;
  revoke)
    need_ca; [[ $# -eq 1 ]] || { echo "usage: $0 revoke <name>" >&2; exit 1; }
    (cd "$OUT" && openssl ca -config ca.cnf -revoke "$1/$1.crt" 2>/dev/null)
    gen_crl
    ;;
  crl) need_ca; gen_crl ;;
  bootstrap)
    # the standard ARGUS PKI in one go: CA, broker, reverse proxy, api client, 4 simulated nodes + hero
    "$0" init
    "$0" server mosquitto "DNS:mosquitto,DNS:host.wokwi.internal,$STD_SERVER_SANS"
    "$0" server outpost "$STD_SERVER_SANS"
    "$0" client argus-api
    for n in sentinel-01 sentinel-02 sentinel-03 sentinel-04 sentinel-hero; do "$0" device "$n" >/dev/null; done
    echo "PKI ready (firmware secrets written for the last node: sentinel-hero)"
    ;;
  *) sed -n '2,10p' "$0"; exit 1 ;;
esac
