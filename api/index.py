import json
import os
import urllib.parse
from http.server import BaseHTTPRequestHandler
from datetime import datetime, timezone
import requests

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
SARVAM_API_KEY = os.getenv("SARVAM_API_KEY", "")
SARVAM_MODEL = os.getenv("SARVAM_MODEL", "sarvam-105b")
DEVICE_API_KEY = os.getenv("DEVICE_API_KEY", "")

SYSTEM_PROMPT = """You are VoltGuard Assistant, the helpful chatbot for a student IoT project called Smart Electricity Leakage Detection & Alert System.
Explain the project in clear, beginner-friendly language. The prototype monitors room occupancy (PIR), electrical current/power, voltage and temperature using an ESP32 and sensors. If a room is unoccupied while an appliance still draws power, it can alert with a buzzer/LED. Abnormal current, voltage or temperature readings may be flagged for inspection. The dashboard can show readings, alerts and history.
Be precise: sensor thresholds are prototype settings, not certified electrical safety limits. Never claim software alone can prove an electrical leakage or make mains wiring safe. Do not instruct users to work on live mains, bypass protection, or build mains switching circuits. Recommend a qualified electrician for electrical faults. The relay is an optional supervised prototype feature; fuse, MCB, RCCB/RCBO and surge protection are additional protection devices, not replacements for professional installation.
"""

def json_response(handler, status, payload):
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type, X-Device-Key")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)

def read_body(handler):
    try:
        length = int(handler.headers.get("Content-Length", "0"))
        if length > 20000:
            return None
        raw = handler.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return None

def supabase_headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    }

def db_ready():
    return bool(SUPABASE_URL and SUPABASE_KEY)

def get_latest_readings(limit=30):
    if not db_ready():
        return None
    url = f"{SUPABASE_URL}/rest/v1/readings"
    params = {"select": "*", "order": "created_at.desc", "limit": str(limit)}
    r = requests.get(url, headers=supabase_headers(), params=params, timeout=15)
    r.raise_for_status()
    return r.json()

def insert_row(table, payload):
    if not db_ready():
        raise RuntimeError("Supabase is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.")
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers=supabase_headers(),
        json=payload,
        timeout=15
    )
    if not r.ok:
        raise RuntimeError(f"Supabase insert failed ({r.status_code}): {r.text[:400]}")
    try:
        data = r.json()
        return data[0] if data else payload
    except Exception:
        return payload

def detect_events(reading):
    events = []
    current = float(reading.get("current_a") or 0)
    voltage = float(reading.get("voltage_v") or 0)
    temp = float(reading.get("temperature_c") or 0)
    occupied = reading.get("occupied")
    appliance_on = reading.get("appliance_on")
    # Educational prototype thresholds only; calibrate sensors and validate safely.
    if occupied is False and appliance_on is True and current > 0.08:
        events.append(("WASTAGE", "Room appears unoccupied while a load is drawing current."))
    if temp >= 55:
        events.append(("TEMPERATURE", "Temperature reading is above the prototype alert threshold (55°C)."))
    if voltage and (voltage < 190 or voltage > 250):
        events.append(("VOLTAGE", "Voltage is outside the prototype monitoring range (190–250 V)."))
    if current >= 10:
        events.append(("CURRENT", "Current reading is above the prototype alert threshold (10 A)."))
    return events

class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        json_response(self, 200, {"ok": True})

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        route = urllib.parse.parse_qs(parsed.query).get("route", [""])[0]
        path = ("/api/" + route.strip("/")) if route else parsed.path
        if path in ("/api", "/api/", "/api/health"):
            json_response(self, 200, {
                "ok": True,
                "service": "VoltGuard API",
                "database_configured": db_ready(),
                "sarvam_configured": bool(SARVAM_API_KEY)
            })
            return
        if path == "/api/readings":
            if not db_ready():
                json_response(self, 200, {"configured": False, "readings": [], "message": "Add Supabase environment variables to enable saved history."})
                return
            try:
                rows = get_latest_readings()
                json_response(self, 200, {"configured": True, "readings": rows})
            except Exception as e:
                json_response(self, 502, {"error": str(e)})
            return
        if path == "/api/events":
            if not db_ready():
                json_response(self, 200, {"configured": False, "events": []})
                return
            try:
                r = requests.get(
                    f"{SUPABASE_URL}/rest/v1/events",
                    headers=supabase_headers(),
                    params={"select": "*", "order": "created_at.desc", "limit": "30"},
                    timeout=15
                )
                r.raise_for_status()
                json_response(self, 200, {"configured": True, "events": r.json()})
            except Exception as e:
                json_response(self, 502, {"error": str(e)})
            return
        json_response(self, 404, {"error": "Route not found"})

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        route = urllib.parse.parse_qs(parsed.query).get("route", [""])[0]
        path = ("/api/" + route.strip("/")) if route else parsed.path
        body = read_body(self)
        if body is None:
            json_response(self, 400, {"error": "Invalid or oversized JSON body"})
            return

        if path == "/api/readings":
            if DEVICE_API_KEY and self.headers.get("X-Device-Key") != DEVICE_API_KEY:
                json_response(self, 401, {"error": "Invalid device key"})
                return
            allowed = ("device_id", "room", "current_a", "voltage_v", "temperature_c",
                       "power_w", "occupied", "appliance_on", "buzzer_on", "led_on")
            reading = {k: body[k] for k in allowed if k in body}
            reading.setdefault("device_id", "room-1")
            reading.setdefault("room", "Main Room")
            try:
                saved = insert_row("readings", reading)
                for event_type, message in detect_events(reading):
                    insert_row("events", {
                        "device_id": reading["device_id"],
                        "event_type": event_type,
                        "message": message,
                        "severity": "warning",
                        "resolved": False
                    })
                json_response(self, 201, {"ok": True, "reading": saved})
            except Exception as e:
                json_response(self, 502, {"error": str(e)})
            return

        if path == "/api/chat":
            if not SARVAM_API_KEY:
                json_response(self, 503, {"error": "Chatbot is not configured yet. Add SARVAM_API_KEY in Vercel Environment Variables."})
                return
            messages = body.get("messages", [])
            if not isinstance(messages, list) or not messages:
                json_response(self, 400, {"error": "Send a non-empty messages array."})
                return
            clean = []
            for item in messages[-12:]:
                if not isinstance(item, dict) or item.get("role") not in ("user", "assistant"):
                    continue
                content = item.get("content", "")
                if isinstance(content, str) and content.strip():
                    clean.append({"role": item["role"], "content": content[:4000]})
            if not clean or clean[-1]["role"] != "user":
                json_response(self, 400, {"error": "The last message must be from the user."})
                return
            payload = {
                "model": SARVAM_MODEL,
                "messages": [{"role": "system", "content": SYSTEM_PROMPT}] + clean,
                "max_tokens": 700,
                "reasoning_effort": None
            }
            try:
                r = requests.post(
                    "https://api.sarvam.ai/v1/chat/completions",
                    headers={"api-subscription-key": SARVAM_API_KEY, "Content-Type": "application/json"},
                    json=payload,
                    timeout=45
                )
                if not r.ok:
                    json_response(self, 502, {"error": f"Sarvam API returned {r.status_code}. Check the API key, model access and usage limits."})
                    return
                result = r.json()
                answer = result.get("choices", [{}])[0].get("message", {}).get("content", "")
                json_response(self, 200, {"reply": answer or "I couldn't generate a response. Please try again."})
            except requests.Timeout:
                json_response(self, 504, {"error": "Sarvam took too long to respond. Please try again."})
            except Exception:
                json_response(self, 502, {"error": "Unable to contact the chatbot service right now."})
            return

        json_response(self, 404, {"error": "Route not found"})

    def log_message(self, format, *args):
        return
