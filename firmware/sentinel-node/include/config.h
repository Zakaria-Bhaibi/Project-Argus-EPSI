#pragma once

// ---- pins (see diagram.json) ----
#define PIN_DHT 15
#define PIN_GAS_AO 34      // ADC1, MQ-2 analog out (sensor powered from 3V3 to stay in ADC range)
#define PIN_PIR 27
#define PIN_TAMPER 4       // push button = case opened
#define PIN_BUZZER 25
#define PIN_LED_GREEN 18
#define PIN_LED_ORANGE 19
#define PIN_LED_RED 23
#define OLED_ADDR 0x3C

// ---- timing ----
#define TELEMETRY_PERIOD_MS 2000
#define MAX_CLOCK_SKEW_S 30

// ---- MQ-2 conversion (log-log datasheet curve, calibrated at boot on clean air) ----
#define GAS_VC 3.3f        // sensor supply
#define GAS_RL 5.0f        // load resistor, kOhm
#define GAS_CLEAN_PPM 180.0f
#define GAS_SLOPE -0.473f  // log10(Rs/R0) per log10(ppm), LPG curve

#define FW_VERSION "argus-fw-1.0"
