// ---------------------------------------------------------------
//  config.h  -  edit this file before uploading to the ESP32
// ---------------------------------------------------------------
#pragma once

// ---- WiFi + server ------------------------------------------------
#define WIFI_SSID      "YOUR_WIFI_NAME"
#define WIFI_PASSWORD  "YOUR_WIFI_PASSWORD"
// IP of the computer / cloud host running server/app.py (no trailing slash)
#define SERVER_URL     "http://192.168.1.50:5000"
#define DEVICE_ID      "room-1"
#define DEVICE_KEY     "changeme"          // must match DEVICE_KEY in server/.env

// ---- Pins (ESP32 DevKit V1) --------------------------------------
#define PIN_PIR        27   // HC-SR501 OUT
#define PIN_CURRENT    34   // ACS712 OUT (through 10k/20k divider!)  ADC1
#define PIN_VOLTAGE    35   // ZMPT101B OUT                            ADC1
#define PIN_TEMP       32   // LM35 OUT                                ADC1
#define PIN_BUZZER     25   // active buzzer
#define PIN_LED        26   // status LED (with 220R)
#define PIN_RELAY      33   // relay module IN (active-LOW module assumed)
#define RELAY_ACTIVE_LOW true

// ---- Sensor calibration ------------------------------------------
// ACS712-05B = 185 mV/A, -20A = 100 mV/A, -30A = 66 mV/A.
// If you use a 10k/20k divider on the output, multiply by 0.667.
#define ACS_MV_PER_A        (185.0f * 0.667f)
#define VOLT_CAL_FACTOR     0.65f   // tune against a multimeter (volts per ADC-RMS count)
#define LM35_MV_PER_C       10.0f
#define ADC_REF_MV          3300.0f
#define ADC_MAX             4095.0f

// ---- Decision-logic thresholds -----------------------------------
#define LOAD_ON_AMPS         0.15f       // above this => an appliance is ON
#define VACANT_AFTER_MS      60000UL     // no motion for 60 s => room is empty (use 10-15 min in real use)
#define ALERT_AFTER_MS       15000UL     // empty + load ON for 15 s => start buzzer
#define OVER_CURRENT_A       10.0f
#define OVER_VOLTAGE_V       250.0f
#define UNDER_VOLTAGE_V      160.0f      // only checked when mains is present (> 50 V)
#define OVER_TEMP_C          60.0f
#define AUTO_CUTOFF_ON_FAULT true        // relay opens on a safety fault

#define SEND_INTERVAL_MS     5000UL
