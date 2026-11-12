"""Flask backend: receives ESP32 telemetry, stores it, serves the dashboard and the chatbot API."""
import os

from flask import Flask, jsonify, request, send_from_directory

import chatbot
import db

try:                                           # optional .env support
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

DEVICE_KEY = os.getenv("DEVICE_KEY", "changeme")
DEFAULT_DEVICE = os.getenv("DEFAULT_DEVICE", "room-1")

app = Flask(__name__, static_folder="static", static_url_path="")
db.init()


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.post("/api/telemetry")
def telemetry():
    if request.headers.get("X-Device-Key") != DEVICE_KEY:
        return jsonify(error="bad device key"), 401
    j = request.get_json(silent=True) or {}
    try:
        d = {
            "device_id": str(j.get("device_id", DEFAULT_DEVICE))[:40],
            "current": float(j["current"]), "voltage": float(j["voltage"]),
            "power": float(j["power"]), "temp": float(j["temp"]),
            "occupied": int(bool(j["occupied"])), "load_on": int(bool(j["load_on"])),
            "alert": int(bool(j["alert"])), "fault": str(j.get("fault", ""))[:30],
            "relay": int(bool(j["relay"])),
        }
    except (KeyError, ValueError, TypeError):
        return jsonify(error="invalid payload"), 400
    db.save_reading(d)
    return jsonify(relay=db.desired_relay(d["device_id"]))


@app.get("/api/latest")
def latest():
    snap = chatbot.snapshot()
    stats = db.energy_stats(db.today_start(), DEFAULT_DEVICE)
    return jsonify(latest=snap, today=stats)


@app.get("/api/history")
def history():
    minutes = min(max(int(request.args.get("minutes", 30)), 1), 1440)
    return jsonify(db.history(minutes, DEFAULT_DEVICE))


@app.get("/api/events")
def events():
    return jsonify(db.events(30))


@app.post("/api/relay")
def relay():
    on = bool((request.get_json(silent=True) or {}).get("on", True))
    db.set_relay(DEFAULT_DEVICE, on)
    return jsonify(relay=on)


@app.post("/api/chat")
def chat():
    msg = (request.get_json(silent=True) or {}).get("message", "")
    return jsonify(chatbot.reply(msg))


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=False)
