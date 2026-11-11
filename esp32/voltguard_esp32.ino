/*
  VoltGuard ESP32 telemetry example.

  This sketch sends sensor values to the Flask server.
  IMPORTANT:
  - This is an educational low-voltage telemetry example, not a certified
    electrical protection device.
  - Do not connect an ESP32, breadboard, or hobby sensor directly to mains.
  - Mains-side sensor installation and any protective switching must be
    designed and installed by a qualified electrician using rated equipment.
  - Replace the placeholder readings below only after your sensor modules
    have been safely installed and calibrated.
*/

#include <WiFi.h>
#include <HTTPClient.h>

const char* WIFI_NAME = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* SERVER_URL = "http://YOUR_COMPUTER_LOCAL_IP:5000/api/readings";

// Placeholder pins: confirm the exact sensor module and ESP32 board first.
const int PIR_PIN = 27;
const int BUZZER_PIN = 26;
const int CURRENT_SENSOR_PIN = 34;

unsigned long lastSend = 0;
const unsigned long SEND_INTERVAL = 5000;

void connectWiFi() {
  WiFi.begin(WIFI_NAME, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWi-Fi connected");
  Serial.print("ESP32 IP: ");
  Serial.println(WiFi.localIP());
}

void setup() {
  Serial.begin(115200);
  pinMode(PIR_PIN, INPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
  connectWiFi();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  if (millis() - lastSend >= SEND_INTERVAL) {
    lastSend = millis();

    bool occupied = digitalRead(PIR_PIN) == HIGH;

    // DEMO PLACEHOLDERS: replace with properly calibrated sensor processing.
    // Do not treat raw ADC values as accurate current/voltage measurements.
    float currentAmps = 0.0;
    float voltageVolts = 230.0;
    float temperatureC = 30.0;
    bool applianceOn = currentAmps > 0.08;

    int rawCurrent = analogRead(CURRENT_SENSOR_PIN);
    Serial.print("Current sensor ADC (raw): ");
    Serial.println(rawCurrent);

    String json = "{";
    json += "\"current\":" + String(currentAmps, 2) + ",";
    json += "\"voltage\":" + String(voltageVolts, 1) + ",";
    json += "\"temperature\":" + String(temperatureC, 1) + ",";
    json += "\"occupied\":" + String(occupied ? "true" : "false") + ",";
    json += "\"appliance_on\":" + String(applianceOn ? "true" : "false");
    json += "}";

    HTTPClient http;
    http.begin(SERVER_URL);
    http.addHeader("Content-Type", "application/json");
    int responseCode = http.POST(json);
    Serial.print("Server response: ");
    Serial.println(responseCode);
    http.end();

    // Local reminder example. Server/dashboard is the primary demo display.
    if (!occupied && applianceOn) {
      digitalWrite(BUZZER_PIN, HIGH);
    } else {
      digitalWrite(BUZZER_PIN, LOW);
    }
  }
}
