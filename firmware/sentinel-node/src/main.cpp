// ARGUS Sentinel-X node: DHT22 + MQ-2 + PIR + tamper switch, OLED status, buzzer + 3 LEDs.
// Talks MQTT over mutual TLS and signs every message (HMAC-SHA256, see docs/architecture.md §3.2).
#include <Arduino.h>
#include <ArduinoJson.h>
#include <DHTesp.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <esp_sntp.h>
#include <mbedtls/md.h>
#include <sys/time.h>
#include <time.h>

#include "config.h"
#include "secrets.h"

static WiFiClientSecure tls;
static PubSubClient mqtt(tls);
static DHTesp dht;
static Adafruit_SSD1306 oled(128, 64, &Wire, -1);

static uint8_t hmacKey[32];
static String topicTelemetry, topicEvents, topicStatus, topicCmd;
static uint64_t lastSeq = 0, lastCmdSeq = 0;
static float gasR0 = 0;  // sensor resistance in clean air (kOhm), set after warm-up
static bool gasCalibrated = false;
static int gasAdc = 0;

static bool lastPir = false, lastTamper = false, buzzerOn = false;
static String ledState = "green", displayText = "", lastEvent = "boot";
static float tC = NAN, hum = NAN, gasPpm = NAN;
static unsigned long lastTelemetry = 0;

// ------------------------------------------------------------------ helpers
static void hexToBytes(const char *hex, uint8_t *out, size_t n) {
  for (size_t i = 0; i < n; i++) sscanf(hex + 2 * i, "%2hhx", &out[i]);
}

static void hmacHex(const char *data, size_t len, char out[65]) {
  uint8_t mac[32];
  mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), hmacKey, sizeof(hmacKey),
                  (const uint8_t *)data, len, mac);
  for (int i = 0; i < 32; i++) sprintf(out + 2 * i, "%02x", mac[i]);
}

static bool constantTimeEq(const char *a, const char *b, size_t n) {
  uint8_t d = 0;
  for (size_t i = 0; i < n; i++) d |= a[i] ^ b[i];
  return d == 0;
}

static uint64_t epochMs() {
  struct timeval tv;
  gettimeofday(&tv, nullptr);
  return (uint64_t)tv.tv_sec * 1000ULL + tv.tv_usec / 1000;
}

static uint64_t nextSeq() {  // strictly increasing, even within the same millisecond
  uint64_t s = epochMs();
  if (s <= lastSeq) s = lastSeq + 1;
  return lastSeq = s;
}

// Builds and publishes  <body>\n<hmac(body)>
static bool publishSigned(const String &topic, const char *type, const String &dataJson) {
  char body[512];
  uint64_t seq = nextSeq();
  int n = snprintf(body, sizeof(body), "{\"v\":1,\"node\":\"%s\",\"seq\":%llu,\"ts\":%lu,\"type\":\"%s\",\"data\":%s}",
                   ARGUS_NODE_ID, (unsigned long long)seq, (unsigned long)(seq / 1000), type, dataJson.c_str());
  if (n <= 0 || n >= (int)sizeof(body)) return false;
  char sig[65];
  hmacHex(body, n, sig);
  String payload = String(body) + "\n" + sig;
  return mqtt.publish(topic.c_str(), payload.c_str());
}

static void sendEvent(const String &kind, const String &extra = "") {
  lastEvent = kind;
  publishSigned(topicEvents, "event", "{\"kind\":\"" + kind + "\"" + (extra.length() ? "," + extra : "") + "}");
}

// ------------------------------------------------------------------ actuators
static void applyLeds() {
  digitalWrite(PIN_LED_GREEN, ledState == "green");
  digitalWrite(PIN_LED_ORANGE, ledState == "orange");
  digitalWrite(PIN_LED_RED, ledState == "red");
}

static void applyBuzzer() {
  if (buzzerOn) tone(PIN_BUZZER, 2200);
  else noTone(PIN_BUZZER);
}

// ------------------------------------------------------------------ MQ-2
static float gasResistance() {
  // oversample: on the log-log curve a small voltage wobble becomes a large ppm swing
  long sum = 0;
  for (int i = 0; i < 16; i++) sum += analogRead(PIN_GAS_AO);
  int raw = gasAdc = sum / 16;
  float v = max(raw, 1) * GAS_VC / 4095.0f;
  if (v >= GAS_VC) v = GAS_VC - 0.001f;
  return (GAS_VC - v) / v * GAS_RL;
}

// Warm-up calibration, like a real MQ-2: R0 is taken once the clean-air reading is stable
// (5-sample average moves < 1 % between samples), or after 30 s at most. Called every 500 ms.
static void calibrateGasStep() {
  static float buf[5];
  static int n = 0;
  static float prevAvg = 0;
  static unsigned long start = millis();
  buf[n++ % 5] = gasResistance();
  if (n < 5) return;
  float avg = 0;
  for (float r : buf) avg += r / 5;
  bool stable = prevAvg > 0 && fabsf(avg - prevAvg) / prevAvg < 0.01f;
  prevAvg = avg;
  if (stable || millis() - start > 30000) {
    gasR0 = avg;
    gasCalibrated = true;
    Serial.printf("[ARGUS] MQ-2 calibrated: R0=%.2f kOhm (adc %d)\n", gasR0, gasAdc);
  }
}

static float readGasPpm() {
  // exponential moving average: the emulated ADC jumps ±300 counts between reads with nothing
  // changing, and the log-log curve amplifies that into fake spikes. A real leak still shows in ~3 reads.
  static float rsAvg = 0;
  float rs = gasResistance();
  rsAvg = rsAvg == 0 ? rs : rsAvg + 0.35f * (rs - rsAvg);
  float ratio = rsAvg / gasR0;  // Rs/R0, falls as gas rises
  return GAS_CLEAN_PPM * powf(ratio, 1.0f / GAS_SLOPE);
}

// ------------------------------------------------------------------ commands (verified)
static void onCommand(char *topic, byte *payload, unsigned int len) {
  String p((const char *)payload, len);
  int nl = p.lastIndexOf('\n');
  if (nl < 0 || p.length() - nl - 1 != 64) { sendEvent("cmd_rejected", "\"reason\":\"unsigned\""); return; }
  String body = p.substring(0, nl), sig = p.substring(nl + 1);

  char expect[65];
  hmacHex(body.c_str(), body.length(), expect);
  if (!constantTimeEq(expect, sig.c_str(), 64)) { sendEvent("cmd_rejected", "\"reason\":\"bad_signature\""); return; }

  JsonDocument doc;
  if (deserializeJson(doc, body)) { sendEvent("cmd_rejected", "\"reason\":\"malformed\""); return; }
  uint64_t seq = doc["seq"].as<uint64_t>();
  long skew = (long)(epochMs() / 1000) - doc["ts"].as<long>();
  if (strcmp(doc["node"] | "", ARGUS_NODE_ID) != 0) { sendEvent("cmd_rejected", "\"reason\":\"wrong_node\""); return; }
  if (abs(skew) > MAX_CLOCK_SKEW_S) { sendEvent("cmd_rejected", "\"reason\":\"stale\""); return; }
  if (seq <= lastCmdSeq) { sendEvent("cmd_rejected", "\"reason\":\"replay\""); return; }
  lastCmdSeq = seq;

  const char *action = doc["data"]["action"] | "";
  JsonVariant value = doc["data"]["value"];
  String ack;
  if (!strcmp(action, "buzzer")) {
    buzzerOn = value.as<bool>(); applyBuzzer();
    ack = String("\"action\":\"buzzer\",\"value\":") + (buzzerOn ? "true" : "false");
  } else if (!strcmp(action, "led")) {
    ledState = value.as<String>(); applyLeds();
    ack = "\"action\":\"led\",\"value\":\"" + ledState + "\"";
  } else if (!strcmp(action, "display")) {
    displayText = value.as<String>().substring(0, 21);
    ack = "\"action\":\"display\",\"value\":\"ok\"";
  } else {
    return;  // "scenario" is for simulated nodes; real sensors are driven from the Wokwi UI
  }
  sendEvent("ack", ack);
}

// ------------------------------------------------------------------ connectivity
static void drawOled(const char *line) {
  oled.clearDisplay();
  oled.setTextSize(1);
  oled.setTextColor(SSD1306_WHITE);
  oled.setCursor(0, 0);
  oled.printf("SENTINEL-X %s\n", ARGUS_NODE_ID + 9);  // "sentinel-hero" -> "hero"
  oled.printf("%s\n", line);
  oled.printf("IP %s\n", WiFi.localIP().toString().c_str());
  oled.printf("T %.1fC  H %.0f%%\n", tC, hum);
  oled.printf("GAS %.0f ppm %s\n", gasPpm, lastPir ? "PIR!" : "");
  oled.printf("evt: %s\n", lastEvent.c_str());
  if (displayText.length()) oled.printf(">%s", displayText.c_str());
  oled.display();
}

static void connectWifi() {
  WiFi.begin("Wokwi-GUEST", "", 6);
  while (WiFi.status() != WL_CONNECTED) { drawOled("WiFi..."); delay(250); }
  // re-sync every 15 s (the minimum): an emulated ESP32 (Wokwi) can run at ~half real-time speed, so its
  // clock falls behind and messages would fail the server's 30 s freshness check (anti-replay)
  sntp_set_sync_interval(15000);
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  drawOled("NTP sync...");
  while (time(nullptr) < 1700000000) delay(200);  // signatures need a real clock (anti-replay)
  Serial.printf("[ARGUS] WiFi %s, clock synced\n", WiFi.localIP().toString().c_str());
}

static void connectMqtt() {
  while (!mqtt.connected()) {
    ledState = "orange"; applyLeds();
    drawOled("MQTTS mTLS...");
    if (mqtt.connect(ARGUS_NODE_ID, nullptr, nullptr, topicStatus.c_str(), 1, true, "offline")) {
      Serial.println("[ARGUS] broker connected (mutual TLS)");
      mqtt.publish(topicStatus.c_str(), "online", true);
      mqtt.subscribe(topicCmd.c_str(), 1);
      sendEvent("boot", "\"fw\":\"" FW_VERSION "\"");
      ledState = "green"; applyLeds();
    } else {
      char err[100];
      tls.lastError(err, sizeof(err));
      Serial.printf("[ARGUS] broker refused (state %d) tls: %s\n", mqtt.state(), err);
      drawOled("broker refused");
      delay(3000);
    }
  }
}

// ------------------------------------------------------------------ main
void setup() {
  Serial.begin(115200);
  pinMode(PIN_PIR, INPUT);
  pinMode(PIN_TAMPER, INPUT_PULLUP);
  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_LED_ORANGE, OUTPUT);
  pinMode(PIN_LED_RED, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  oled.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR);
  dht.setup(PIN_DHT, DHTesp::DHT22);
  analogReadResolution(12);

  hexToBytes(ARGUS_HMAC_KEY_HEX, hmacKey, sizeof(hmacKey));
  String base = String("argus/v1/nodes/") + ARGUS_NODE_ID + "/";
  topicTelemetry = base + "telemetry"; topicEvents = base + "events";
  topicStatus = base + "status";       topicCmd = base + "cmd";


  connectWifi();
  tls.setCACert(ARGUS_CA_CERT);
  tls.setCertificate(ARGUS_CLIENT_CERT);
  tls.setPrivateKey(ARGUS_CLIENT_KEY);
  mqtt.setServer(ARGUS_BROKER_HOST, ARGUS_BROKER_PORT);
  mqtt.setBufferSize(1024);
  mqtt.setKeepAlive(30);
  mqtt.setCallback(onCommand);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWifi();
  if (!mqtt.connected()) connectMqtt();
  mqtt.loop();

  bool pir = digitalRead(PIN_PIR);
  if (pir && !lastPir) sendEvent("pir", "\"value\":true");
  lastPir = pir;

  bool tamper = digitalRead(PIN_TAMPER) == LOW;
  if (tamper && !lastTamper) sendEvent("tamper");
  lastTamper = tamper;

  static unsigned long lastCal = 0;
  if (!gasCalibrated && millis() - lastCal >= 500) { lastCal = millis(); calibrateGasStep(); }

  if (millis() - lastTelemetry >= TELEMETRY_PERIOD_MS) {
    lastTelemetry = millis();
    TempAndHumidity th = dht.getTempAndHumidity();
    if (!isnan(th.temperature)) { tC = th.temperature; hum = th.humidity; }
    char data[200];
    if (gasCalibrated) {
      gasPpm = readGasPpm();
      snprintf(data, sizeof(data), "{\"temp_c\":%.2f,\"hum_pct\":%.1f,\"gas_ppm\":%.1f,\"gas_adc\":%d,\"pir\":%s}",
               tC, hum, gasPpm, gasAdc, pir ? "true" : "false");
    } else {  // no gas value until the MQ-2 has warmed up: never report a number we don't trust
      snprintf(data, sizeof(data), "{\"temp_c\":%.2f,\"hum_pct\":%.1f,\"gas_adc\":%d,\"pir\":%s}",
               tC, hum, gasAdc, pir ? "true" : "false");
    }
    publishSigned(topicTelemetry, "telemetry", data);
    drawOled(!gasCalibrated ? "MQ-2 warm-up" : buzzerOn ? "TLS OK  ALARM!" : "TLS OK");
  }
}
