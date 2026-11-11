from flask import Flask, render_template, request, jsonify
import sqlite3
from pathlib import Path
from datetime import datetime, timedelta
import random
import re

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "electricity.db"
app = Flask(__name__)

def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS readings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                current REAL NOT NULL,
                voltage REAL NOT NULL,
                temperature REAL NOT NULL,
                occupied INTEGER NOT NULL,
                appliance_on INTEGER NOT NULL,
                alert TEXT NOT NULL
            )
        """)
        count = conn.execute("SELECT COUNT(*) FROM readings").fetchone()[0]
        if count == 0:
            now = datetime.now()
            for i in range(23, -1, -1):
                occupied = 1 if random.random() > 0.28 else 0
                appliance = 1 if random.random() > 0.25 else 0
                current = round(random.uniform(0.15, 1.6), 2) if appliance else 0.02
                voltage = round(random.uniform(218, 238), 1)
                temp = round(random.uniform(27, 39), 1)
                alert = "WASTAGE" if not occupied and appliance else "NORMAL"
                conn.execute("""
                    INSERT INTO readings
                    (created_at,current,voltage,temperature,occupied,appliance_on,alert)
                    VALUES (?,?,?,?,?,?,?)
                """, ((now - timedelta(minutes=i*5)).isoformat(timespec="seconds"),
                      current, voltage, temp, occupied, appliance, alert))

def latest_reading():
    with db() as conn:
        row = conn.execute("SELECT * FROM readings ORDER BY id DESC LIMIT 1").fetchone()
        return dict(row) if row else None

def evaluate_alert(current, voltage, temperature, occupied, appliance_on):
    # Demo thresholds only. Calibrate against the actual sensor and local standards.
    if temperature >= 55:
        return "TEMPERATURE WARNING"
    if voltage < 190 or voltage > 250:
        return "VOLTAGE WARNING"
    if not occupied and appliance_on and current > 0.08:
        return "WASTAGE"
    return "NORMAL"

@app.route("/")
def home():
    return render_template("index.html")

@app.get("/api/status")
def status():
    latest = latest_reading()
    with db() as conn:
        total = conn.execute("SELECT COUNT(*) FROM readings").fetchone()[0]
        alerts = conn.execute("SELECT COUNT(*) FROM readings WHERE alert != 'NORMAL'").fetchone()[0]
    return jsonify({"latest": latest, "total_readings": total, "alert_count": alerts})

@app.get("/api/history")
def history():
    with db() as conn:
        rows = conn.execute("""
            SELECT created_at,current,voltage,temperature,occupied,appliance_on,alert
            FROM readings ORDER BY id DESC LIMIT 30
        """).fetchall()
    data = [dict(row) for row in rows][::-1]
    return jsonify(data)

@app.post("/api/readings")
def add_reading():
    payload = request.get_json(silent=True) or {}
    required = ["current", "voltage", "temperature", "occupied", "appliance_on"]
    if any(key not in payload for key in required):
        return jsonify({"error": "Missing one or more sensor fields."}), 400
    try:
        current = max(0, min(float(payload["current"]), 100))
        voltage = max(0, min(float(payload["voltage"]), 500))
        temperature = max(-40, min(float(payload["temperature"]), 150))
        occupied = 1 if bool(payload["occupied"]) else 0
        appliance_on = 1 if bool(payload["appliance_on"]) else 0
    except (TypeError, ValueError):
        return jsonify({"error": "Sensor values must be valid numbers or booleans."}), 400

    alert = evaluate_alert(current, voltage, temperature, occupied, appliance_on)
    created_at = datetime.now().isoformat(timespec="seconds")
    with db() as conn:
        conn.execute("""
            INSERT INTO readings
            (created_at,current,voltage,temperature,occupied,appliance_on,alert)
            VALUES (?,?,?,?,?,?,?)
        """, (created_at, current, voltage, temperature, occupied, appliance_on, alert))
    return jsonify({"ok": True, "alert": alert, "created_at": created_at}), 201

@app.post("/api/demo")
def demo_reading():
    occupied = random.choice([0, 1, 1, 1])
    appliance_on = random.choice([0, 1, 1])
    current = round(random.uniform(0.2, 1.8), 2) if appliance_on else 0.02
    voltage = round(random.uniform(218, 238), 1)
    temperature = round(random.uniform(28, 42), 1)
    # Occasionally produce a demo warning so the alert UI can be tested.
    if random.random() < 0.12:
        occupied, appliance_on, current = 0, 1, round(random.uniform(0.3, 1.2), 2)
    alert = evaluate_alert(current, voltage, temperature, occupied, appliance_on)
    created_at = datetime.now().isoformat(timespec="seconds")
    with db() as conn:
        conn.execute("""
            INSERT INTO readings
            (created_at,current,voltage,temperature,occupied,appliance_on,alert)
            VALUES (?,?,?,?,?,?,?)
        """, (created_at, current, voltage, temperature, occupied, appliance_on, alert))
    return jsonify({"ok": True, "alert": alert})

def chatbot_reply(message):
    q = message.lower().strip()
    if not q:
        return "Ask me about the dashboard, sensors, alerts, occupancy, or energy saving."
    if any(word in q for word in ["hello", "hi", "hey"]):
        return "Hello! I'm VoltAssist. I can explain your readings, alerts, sensors, and energy-saving features."
    if "current" in q or "acs712" in q:
        return "The current sensor (ACS712 in this project) measures current drawn by the monitored load. A sustained reading while the room is unoccupied may indicate unnecessary energy use. The prototype threshold must be calibrated for your sensor."
    if "voltage" in q or "zmpt" in q:
        return "Voltage monitoring helps identify readings outside the configured demo range. This dashboard currently flags values below 190 V or above 250 V. These are example software thresholds, not a substitute for certified protection."
    if "temperature" in q or "heat" in q or "overheat" in q:
        return "The temperature field helps demonstrate overheating alerts. This demo raises a warning at 55°C. Use a suitable, correctly rated sensor and have electrical equipment assessed by a qualified electrician."
    if "pir" in q or "occup" in q or "motion" in q or "room" in q:
        return "The PIR sensor detects movement. If the room is considered unoccupied while a connected appliance still draws current, the system marks it as possible electricity wastage and activates an alert."
    if "alert" in q or "warning" in q or "wastage" in q or "leak" in q:
        latest = latest_reading() or {}
        alert = latest.get("alert", "No data")
        if alert == "WASTAGE":
            return "The latest reading is marked WASTAGE: the room is unoccupied while an appliance appears to be drawing current. Check the appliance and room status. This is a reminder, not proof of an electrical leakage fault."
        if alert != "NORMAL":
            return f"The latest dashboard status is {alert}. Treat it as a warning and ask a qualified electrician to inspect the installation. Do not touch wiring or open electrical panels."
        return "No abnormal condition is flagged in the latest demo reading. The system checks occupancy, current, voltage, and temperature. A normal dashboard status does not guarantee an installation is electrically safe."
    if "save" in q or "saving" in q or "energy" in q or "electricity bill" in q:
        return "Turn off lights, fans, and other appliances when they are not needed; use efficient appliances; and investigate unusual consumption. This prototype reminds users when loads remain on in an unoccupied room."
    if "sensor" in q or "component" in q:
        return "The project uses an ESP32 controller, PIR occupancy sensor, current sensor, buzzer, and optional voltage and temperature sensors. The dashboard stores readings in SQLite."
    if "how" in q and ("work" in q or "system" in q):
        return "PIR senses room movement and the current sensor checks whether a monitored load is drawing power. The ESP32 sends readings to the Flask server. The server evaluates simple rules, stores readings, and updates the dashboard and alerts."
    if "safe" in q or "safety" in q:
        return "This is an educational monitoring prototype, not a certified safety device. Never work on live mains wiring. Use proper certified protection devices and have all mains-side installation done by a qualified electrician."
    return "I can help with current, voltage, temperature, PIR occupancy, alerts, sensors, system operation, and energy-saving tips. Try asking: 'Why is the wastage alert active?'"

@app.post("/api/chat")
def chat():
    payload = request.get_json(silent=True) or {}
    message = str(payload.get("message", ""))[:500]
    return jsonify({"reply": chatbot_reply(message)})

if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000, debug=True)
