// Template only. The real include/secrets.h is generated per node by:
//   BROKER_HOST=host.wokwi.internal infra/pki/firmware-secrets.sh sentinel-hero
// and is gitignored. Never commit keys.
#pragma once
#define ARGUS_NODE_ID "sentinel-hero"
#define ARGUS_BROKER_HOST "host.wokwi.internal"
#define ARGUS_BROKER_PORT 8883
#define ARGUS_HMAC_KEY_HEX "<64 hex chars>"
static const char ARGUS_CA_CERT[] = "-----BEGIN CERTIFICATE-----\n...";
static const char ARGUS_CLIENT_CERT[] = "-----BEGIN CERTIFICATE-----\n...";
static const char ARGUS_CLIENT_KEY[] = "-----BEGIN EC PRIVATE KEY-----\n...";
