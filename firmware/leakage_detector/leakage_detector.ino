/*
  Smart Electricity Leakage Detector  -  ESP32 firmware
  MLR Institute of Technology, Team 6 (Micro Project)

  What it does
   1. PIR sensor        -> is anyone in the room?
   2. ACS712            -> are appliances drawing current?
   3. ZMPT101B + LM35   -> mains voltage and temperature (safety monitoring)
   4. Room empty + load ON for a while -> buzzer + LED reminder.
      Buzzer stops when the load is switched off or someone returns.
   5. Over-current / over-voltage / under-voltage / over-temperature
      -> alarm and (optionally) relay cut-off.
   6. Sends readings to the Flask server every few seconds; the server
      replies with the desired relay state (so the dashboard / chatbot
      can switch the load off remotely).

  Board : "ESP32 Dev Module"   Libraries: only the ones bundled with the ESP32 core.
*/
#include <WiFi.h>
#include <HTTPClient.h>
#include <math.h>
#include "config.h"

// ----------------------------- state -------------------------------
float irms = 0, vrms = 0, tempC = 0, powerW = 0;
bool  occupied = true, loadOn = false, alertActive = false, faultActive = false;
bool  relayOn = true;            // true = load connected
bool  remoteRelayWanted = true;
String faultText = "";

unsigned long lastMotionMs = 0, emptyLoadSinceMs = 0, lastSendMs = 0;

// ----------------------------- helpers -----------------------------
void setRelay(bool on) {
  relayOn = on;
  bool level = RELAY_ACTIVE_LOW ? !on : on;
  digitalWrite(PIN_RELAY, level ? HIGH : LOW);
}

// RMS of an AC-coupled analog signal around its own mean (returns mV RMS)
float readRmsMv(int pin, int samples = 600) {
  double sum = 0, sumSq = 0;
  for (int i = 0; i < samples; i++) {
    float mv = analogReadMilliVolts(pin);
    sum += mv;
    sumSq += (double)mv * mv;
    delayMicroseconds(150);                // ~ 0.09 s window = ~4-5 mains cycles
  }
  double mean = sum / samples;
  double var = sumSq / samples - mean * mean;
  return var > 0 ? sqrt(var) : 0;
}

float readTempC() {
  long acc = 0;
  for (int i = 0; i < 32; i++) { acc += analogReadMilliVolts(PIN_TEMP); delay(2); }
  return (acc / 32.0f) / LM35_MV_PER_C;
}

void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("WiFi");
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 8000) { delay(250); Serial.print("."); }
  Serial.println(WiFi.status() == WL_CONNECTED ? " connected " + WiFi.localIP().toString() : " failed (offline mode)");
}

// ----------------------------- sensing -----------------------------
void readSensors() {
  irms  = readRmsMv(PIN_CURRENT) / ACS_MV_PER_A;
  if (irms < 0.05f) irms = 0;              // noise floor
  vrms  = readRmsMv(PIN_VOLTAGE) * VOLT_CAL_FACTOR;
  if (vrms < 20.0f) vrms = 0;
  tempC = readTempC();
  powerW = irms * vrms;                    // apparent power (VA) ~ W for resistive loads
  if (digitalRead(PIN_PIR) == HIGH) lastMotionMs = millis();
}

// ----------------------------- logic -------------------------------
void evaluate() {
  unsigned long now = millis();
  occupied = (now - lastMotionMs) < VACANT_AFTER_MS;
  loadOn   = irms > LOAD_ON_AMPS;

  // 1) forgotten-appliance reminder
  if (!occupied && loadOn) {
    if (emptyLoadSinceMs == 0) emptyLoadSinceMs = now;
    alertActive = (now - emptyLoadSinceMs) > ALERT_AFTER_MS;
  } else {
    emptyLoadSinceMs = 0;
    alertActive = false;
  }

  // 2) electrical safety faults
  faultText = "";
  if (irms  > OVER_CURRENT_A)                         faultText = "OVER_CURRENT";
  else if (vrms > OVER_VOLTAGE_V)                     faultText = "OVER_VOLTAGE";
  else if (vrms > 50 && vrms < UNDER_VOLTAGE_V)       faultText = "UNDER_VOLTAGE";
  else if (tempC > OVER_TEMP_C)                       faultText = "OVER_TEMPERATURE";
  faultActive = faultText.length() > 0;

  // 3) relay: safety cut-off first, otherwise follow the server's wish
  if (faultActive && AUTO_CUTOFF_ON_FAULT) setRelay(false);
  else                                     setRelay(remoteRelayWanted);
}

void drive_outputs() {
  unsigned long now = millis();
  if (faultActive) {                        // fast beeping + solid LED
    digitalWrite(PIN_BUZZER, (now / 150) % 2);
    digitalWrite(PIN_LED, HIGH);
  } else if (alertActive) {                 // slow beep: 400 ms on / 600 ms off
    digitalWrite(PIN_BUZZER, (now % 1000) < 400);
    digitalWrite(PIN_LED, (now / 250) % 2);
  } else {
    digitalWrite(PIN_BUZZER, LOW);
    digitalWrite(PIN_LED, occupied ? HIGH : LOW);   // LED on = room occupied
  }
}

// ----------------------------- network -----------------------------
void sendTelemetry() {
  if (WiFi.status() != WL_CONNECTED) { connectWifi(); return; }
  HTTPClient http;
  http.setTimeout(4000);
  http.begin(String(SERVER_URL) + "/api/telemetry");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", DEVICE_KEY);

  char body[360];
  snprintf(body, sizeof(body),
    "{\"device_id\":\"%s\",\"current\":%.3f,\"voltage\":%.1f,\"power\":%.1f,\"temp\":%.1f,"
    "\"occupied\":%d,\"load_on\":%d,\"alert\":%d,\"fault\":\"%s\",\"relay\":%d}",
    DEVICE_ID, irms, vrms, powerW, tempC,
    occupied, loadOn, alertActive, faultText.c_str(), relayOn);

  int code = http.POST((uint8_t*)body, strlen(body));
  if (code == 200) {
    String resp = http.getString();                 // {"relay": true}
    remoteRelayWanted = resp.indexOf("\"relay\":false") < 0 && resp.indexOf("\"relay\": false") < 0;
  } else {
    Serial.printf("POST failed: %d\n", code);
  }
  http.end();
}

// ----------------------------- arduino -----------------------------
void setup() {
  Serial.begin(115200);
  pinMode(PIN_PIR, INPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_RELAY, OUTPUT);
  setRelay(true);
  analogSetAttenuation(ADC_11db);

  delay(500);
  lastMotionMs = millis();
  connectWifi();
  Serial.println("Smart Electricity Leakage Detector ready");
}

void loop() {
  readSensors();
  evaluate();
  drive_outputs();

  if (millis() - lastSendMs >= SEND_INTERVAL_MS) {
    lastSendMs = millis();
    sendTelemetry();
    Serial.printf("I=%.2fA V=%.0fV P=%.0fW T=%.1fC occ=%d load=%d alert=%d fault=%s relay=%d\n",
                  irms, vrms, powerW, tempC, occupied, loadOn, alertActive, faultText.c_str(), relayOn);
  }
}
