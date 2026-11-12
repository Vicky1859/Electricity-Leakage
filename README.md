# Smart Electricity Leakage Detector (ESP32 + IoT dashboard + chatbot)

MLR Institute of Technology · CSE-A · Team 6 · Micro Project

An IoT system that stops electricity being wasted and warns about unsafe conditions:

- **Forgotten-appliance reminder** – PIR sensor + ACS712 current sensor. Room empty + appliances still ON → buzzer + LED.
- **Safety monitoring** – ZMPT101B (voltage) and LM35 (temperature). Over-current, over/under-voltage, over-temperature → alarm and relay cut-off.
- **IoT dashboard + database** – live readings, power chart, events, energy (kWh), cost and *wasted* energy.
- **Chatbot** – ask "status", "energy today", "why is the buzzer on?", "turn off". Works offline (rule-based); add an `ANTHROPIC_API_KEY` for AI answers.

```
Sensors ─► ESP32 ──WiFi/HTTP──► Flask server ─► SQLite
 (PIR, ACS712,   ▲                 │  ├─ dashboard (index.html)
  ZMPT101B,      └── relay cmd ◄───┘  └─ /api/chat  (chatbot)
  LM35)  ──► Buzzer / LED / Relay
```

## Folder structure

```
firmware/leakage_detector/   ESP32 sketch  (.ino + config.h)
server/                      Flask API, SQLite, chatbot, dashboard (static/index.html)
simulator/simulate.py        fake ESP32 so you can demo without hardware
```

## 1. Run the server (no hardware needed)

```bash
cd server
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                   # Windows: copy .env.example .env
python app.py                                          # http://localhost:5000
```

In a second terminal start the simulator:

```bash
python simulator/simulate.py --fast
```

Open http://localhost:5000, click the 💬 button and try the chips.

## 2. Flash the ESP32

1. Arduino IDE → install **ESP32 board support** (Boards Manager: "esp32" by Espressif). Board: *ESP32 Dev Module*.
2. Open `firmware/leakage_detector/leakage_detector.ino`.
3. Edit `config.h`: WiFi name/password and `SERVER_URL` = your computer's IP (`ipconfig` / `ifconfig`), port 5000. Phone hotspot or same WiFi as the PC.
4. Upload, open Serial Monitor at 115200 baud.

No extra libraries are needed.

## 3. Wiring (ESP32 DevKit V1)

| Part | Part pin | ESP32 |
|---|---|---|
| HC-SR501 PIR | OUT / VCC / GND | GPIO27 / 5V (VIN) / GND |
| ACS712 | OUT → **10k/20k divider** → | GPIO34 (VCC 5V, GND) |
| ZMPT101B | OUT / VCC / GND | GPIO35 / 5V / GND |
| LM35 | OUT / VCC / GND | GPIO32 / 5V / GND |
| Buzzer (active) | + | GPIO25 (− to GND) |
| LED | via 220 Ω | GPIO26 |
| Relay module | IN | GPIO33 (VCC 5V, GND) |

**ACS712 divider:** the sensor outputs up to 5 V but the ESP32 ADC tolerates only 3.3 V. Put 10 kΩ from OUT to the ESP32 pin and 20 kΩ from that pin to GND. `ACS_MV_PER_A` in `config.h` already assumes this (185 mV/A × 0.667 for the 5 A module; change 185 to 100 for 20 A or 66 for 30 A).

**Calibration:** compare the dashboard voltage with a multimeter and adjust `VOLT_CAL_FACTOR`; check the current with a known load (e.g. a 60 W bulb ≈ 0.26 A at 230 V).

## ⚠ Safety

Mains (230 V) can kill. For the demo, power a **bulb or small fan through the relay/current sensor only with an insulated, enclosed setup** and have your lab guide check it. Keep the ESP32 side low-voltage. The fuse, MCB, RCCB/RCBO and SPD from the abstract provide the real protection: the ESP32 monitors and alerts, it does not replace them.

## 4. Chatbot

`POST /api/chat {"message": "..."}` → `{"reply": "...", "action": null|"relay_off"|"relay_on", "mode": "rules"|"llm"}`

Example questions: *status · is the room empty? · what is the voltage? · energy today · how much did I waste? · any alerts? · why is the buzzer on? · tips to save power · how does this work? · turn off · turn on*

To enable AI answers, put `ANTHROPIC_API_KEY=...` in `server/.env`. The bot then sends your question plus a live snapshot of the system to Claude; relay commands ("turn off") are always handled by fixed rules, never by the model.

## 5. Tuning the logic (`config.h`)

| Setting | Demo | Real use |
|---|---|---|
| `VACANT_AFTER_MS` | 60 s | 10–15 min |
| `ALERT_AFTER_MS` | 15 s | 30–60 s |
| `LOAD_ON_AMPS` | 0.15 A | above your standby current |

## 6. Put it on GitHub

```bash
git init
git add .
git commit -m "Smart Electricity Leakage Detector: firmware, server, dashboard, chatbot"
git branch -M main
git remote add origin https://github.com/<your-username>/smart-electricity-leakage-detector.git
git push -u origin main
```

Don't commit your real WiFi password: put placeholders in `config.h` before pushing.

## Team

T. Vishal (26R21A0558) · K. Neha (26R21A0548) · M. Shiva Reddy (26R21A0549) · K. Niroja (26R21A0533) · K. Sai Vaibhav (26R21A0535)
