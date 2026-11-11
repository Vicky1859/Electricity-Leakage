from flask import Flask, render_template, request, jsonify
from groq import Groq
import os
import sqlite3
from pathlib import Path
from datetime import datetime, timedelta
import random
import re

BASE_DIR = Path(__file__).resolve().parent
IS_VERCEL = bool(os.environ.get("VERCEL"))
DB_PATH = (Path("/tmp") / "voltguard.db") if IS_VERCEL else (BASE_DIR / "electricity.db")
app = Flask(__name__, static_folder="public", static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024

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
    if not valid_device_token():
        return jsonify({"error": "Unauthorized device."}), 401
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

def chatbot_reply(message, history=None):
    """Generate a project-aware answer with Groq. The API key stays server-side."""
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        return None, "The AI chatbot is not configured yet. Add GROQ_API_KEY in Vercel → Project Settings → Environment Variables, then redeploy."

    latest = latest_reading() or {}
    sensor_context = (
        f"Latest dashboard reading: current={latest.get('current', 'unknown')} A, "
        f"voltage={latest.get('voltage', 'unknown')} V, "
        f"temperature={latest.get('temperature', 'unknown')} C, "
        f"room={'occupied' if latest.get('occupied') else 'unoccupied' if latest else 'unknown'}, "
        f"appliance={'on' if latest.get('appliance_on') else 'off' if latest else 'unknown'}, "
        f"status={latest.get('alert', 'unknown')}."
    )
    system_prompt = """You are VoltAssist, the friendly AI assistant inside a B.Tech student educational prototype called VoltGuard: Smart Electricity Leakage Detection & Alert System.
Answer clearly and accurately in accessible language. Explain the dashboard, ESP32, current sensor (ACS712), voltage sensor (ZMPT101B), temperature sensor, PIR occupancy sensor, alerts, project architecture, and energy-saving concepts when relevant. Use the supplied latest dashboard context when it helps, but say readings are demo/sample values if appropriate. Distinguish possible energy wastage from confirmed electrical leakage: an unoccupied room with an appliance drawing current is a wastage reminder, not proof of leakage. Configured demo thresholds (55 C, below 190 V or above 250 V, and unoccupied + appliance on + current above 0.08 A) are examples only, not certified safety limits. Never tell the user to touch wiring, open electrical panels, bypass protection, or work on live mains. For electrical faults, advise switching away from the equipment if safe and getting a qualified electrician/adult to inspect it. State that this student prototype is not a certified safety device. Keep answers concise but useful. If asked unrelated questions, answer briefly and steer back to project help."""

    messages = [{"role": "system", "content": system_prompt + "\n\n" + sensor_context}]
    if isinstance(history, list):
        for item in history[-8:]:
            if not isinstance(item, dict):
                continue
            role = item.get("role")
            content = item.get("content")
            if role in ("user", "assistant") and isinstance(content, str):
                messages.append({"role": role, "content": content[:1000]})
    messages.append({"role": "user", "content": message[:1000]})

    try:
        client = Groq(api_key=api_key)
        completion = client.chat.completions.create(
            model=os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile"),
            messages=messages,
            temperature=0.5,
            max_tokens=600,
        )
        answer = completion.choices[0].message.content
        return (answer or "I couldn't create a response. Please try again."), None
    except Exception as exc:
        # Keep provider details out of the browser response and server logs minimal.
        app.logger.exception("Groq chat request failed")
        return None, "VoltAssist could not reach the AI service right now. Check that your Groq key and model setting are correct, then try again."

@app.post("/api/chat")
def chat():
    payload = request.get_json(silent=True) or {}
    message = str(payload.get("message", "")).strip()
    if not message:
        return jsonify({"error": "Please enter a message."}), 400
    if len(message) > 1000:
        return jsonify({"error": "Please keep your message under 1,000 characters."}), 400
    reply, error = chatbot_reply(message, payload.get("history", []))
    if error:
        return jsonify({"error": error}), 503
    return jsonify({"reply": reply})

# Optional device authentication. Set DEVICE_API_TOKEN in Vercel and the ESP32
# firmware to protect the telemetry endpoint. Leave unset for local classroom demos.
def valid_device_token():
    expected = os.environ.get("DEVICE_API_TOKEN")
    if not expected:
        return True
    supplied = request.headers.get("Authorization", "")
    return supplied == f"Bearer {expected}"

# Wrap the existing telemetry route with an optional token check.
_original_add_reading = add_reading
@app.post("/api/device/readings")
def device_reading():
    if not valid_device_token():
        return jsonify({"error": "Unauthorized device."}), 401
    return _original_add_reading()

# Initialize the small demo database when the Vercel function starts or locally.
init_db()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=False)
