// Argus smoke test: proves the simulated ESP32 can reach a TLS server on the host
// through the Wokwi for VS Code bundled IoT gateway.
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

static const char *WIFI_SSID = "Wokwi-GUEST";
static const char *HOST = "host.wokwi.internal";
static const uint16_t PORT = 8883;
static const int LED_PIN = 2;

// Public CA certificate of the throwaway smoke-test CA (tools/smoke-certs/ca.crt).
// Not a secret: the private key never leaves the host.
static const char *CA_CERT = R"(-----BEGIN CERTIFICATE-----
MIIBkDCCATegAwIBAgIUJZWhzMFs3AaeBv1WgCbZoHfML6UwCgYIKoZIzj0EAwIw
HjEcMBoGA1UEAwwTQXJndXMgU21va2UgVGVzdCBDQTAeFw0yNjEwMDUxOTQyMzNa
Fw0yNzEwMDUxOTQyMzNaMB4xHDAaBgNVBAMME0FyZ3VzIFNtb2tlIFRlc3QgQ0Ew
WTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAASWDXIwyPbLLa/p0LToz1v83Uzb2iV1
XtZIZuberuW2uXDIGJxLa+tXwsnvcOE8jEY9Yg2VjdRrKP11lZNKVeKHo1MwUTAd
BgNVHQ4EFgQULEfWmpiHq135dXzCjf39/vcqkTMwHwYDVR0jBBgwFoAULEfWmpiH
q135dXzCjf39/vcqkTMwDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNHADBE
AiA+/pmqjGAw9bmsClUI3JGtGFdDv8168PH2GRruwPNy0gIgMvMZ2VHvzfhHjZvY
AMiZKm5ywrWBMurvDTl3hDtAFLk=
-----END CERTIFICATE-----
)";

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  Serial.println("\n[ARGUS] smoke test boot");

  WiFi.begin(WIFI_SSID, "", 6);  // channel 6 makes Wokwi connect faster
  while (WiFi.status() != WL_CONNECTED) {
    delay(250);
    Serial.print('.');
  }
  Serial.printf("\n[ARGUS] WiFi OK, IP=%s\n", WiFi.localIP().toString().c_str());
}

void loop() {
  WiFiClientSecure client;
  client.setCACert(CA_CERT);

  Serial.printf("[ARGUS] TLS connect to %s:%u ...\n", HOST, PORT);
  if (!client.connect(HOST, PORT)) {
    char err[128];
    client.lastError(err, sizeof(err));
    Serial.printf("[ARGUS] FAIL: %s\n", err);
    digitalWrite(LED_PIN, LOW);
    delay(5000);
    return;
  }

  client.printf("{\"node\":\"sentinel-hero-01\",\"msg\":\"hello from wokwi\",\"uptime_ms\":%lu}\n", millis());
  String reply = client.readStringUntil('\n');
  Serial.printf("[ARGUS] PASS - server replied: %s\n", reply.c_str());
  digitalWrite(LED_PIN, HIGH);
  client.stop();
  delay(5000);
}
