"""Chatbot for the Smart Electricity Leakage Detector.

Two modes
  * Rule-based (default, works offline, no API key needed): matches intents from keywords and
    answers using live data from the database.
  * LLM mode (optional): set ANTHROPIC_API_KEY and the bot sends the question plus a live
    snapshot of the system to Claude for a more natural answer. Falls back to rules on any error.
"""
import json
import os
import re
import time
import urllib.request

import db

DEVICE = os.getenv("DEFAULT_DEVICE", "room-1")
API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "claude-haiku-5-5")

FAULT_TEXT = {
    "OVER_CURRENT": "current is above the safe limit (possible overload or short circuit)",
    "OVER_VOLTAGE": "mains voltage is too high",
    "UNDER_VOLTAGE": "mains voltage is too low",
    "OVER_TEMPERATURE": "temperature is too high (possible overheating wire or appliance)",
}

SYSTEM_PROMPT = """You are the assistant inside a Smart Electricity Leakage Detector (ESP32 IoT project by a B.Tech
student team). The system uses a PIR sensor (occupancy), ACS712 (current), ZMPT101B (voltage), a temperature sensor,
a relay (cut-off), a buzzer and LED. It sounds a buzzer when a room is empty but appliances are still ON, raises
safety faults (over-current, over/under-voltage, over-temperature) and logs everything to a database. Fuse, MCB,
RCCB/RCBO and SPD provide the real electrical protection; the ESP32 only monitors and alerts.
Answer briefly and in plain language, using ONLY the live data given. If asked to switch the load, tell the user to
type 'turn off' or 'turn on'. Never tell users to work on live mains wiring."""


# ----------------------------------------------------------------- helpers
def _ago(ts):
    s = int(time.time() - ts)
    if s < 60:
        return f"{s}s ago"
    if s < 3600:
        return f"{s // 60} min ago"
    return f"{s // 3600} h ago"


def snapshot():
    r = db.latest(DEVICE)
    if not r:
        return None
    age = time.time() - r["ts"]
    return {**r, "age_s": int(age), "online": age < 30}


def _status_line(r):
    room = "occupied" if r["occupied"] else "empty"
    load = "ON" if r["load_on"] else "OFF"
    return (f"Room is {room}, appliances are {load}. {r['current']:.2f} A, {r['voltage']:.0f} V, "
            f"{r['power']:.0f} W, {r['temp']:.1f} °C. Load relay: {'connected' if r['relay'] else 'cut off'}.")


def _has(text, *words):
    return any(re.search(r"\b" + re.escape(w), text) for w in words)


# ----------------------------------------------------------------- rule-based brain
def rule_reply(msg):
    t = msg.lower().strip()
    r = snapshot()
    result = {"reply": "", "action": None}

    # --- control commands first
    if _has(t, "turn off", "switch off", "cut", "shut off", "disconnect") and not _has(t, "how", "why", "should"):
        db.set_relay(DEVICE, False)
        result.update(reply="Done. I've told the device to cut the load (relay OFF). It will apply within ~5 seconds. "
                            "Say 'turn on' to restore power.", action="relay_off")
        return result
    if _has(t, "turn on", "switch on", "restore", "reconnect", "power on") and not _has(t, "how", "why"):
        db.set_relay(DEVICE, True)
        result.update(reply="Done. Relay ON requested; power will be restored within ~5 seconds "
                            "(unless a safety fault is still active).", action="relay_on")
        return result

    # --- greetings / help
    if re.fullmatch(r"(hi|hello|hey|hii+|good (morning|afternoon|evening))[!. ]*", t):
        result["reply"] = ("Hi! I'm the Leakage Detector assistant. Ask me about the room status, voltage/current, "
                           "today's energy and cost, alerts, or energy-saving tips. You can also say 'turn off'.")
        return result
    if _has(t, "help", "what can you", "commands"):
        result["reply"] = ("Try: 'status', 'is the room empty?', 'what is the voltage?', 'energy today', "
                           "'how much did I waste?', 'any alerts?', 'why is the buzzer on?', 'tips to save power', "
                           "'how does this work?', 'turn off' / 'turn on'.")
        return result

    # --- questions about the project itself (no live data needed)
    if _has(t, "how does", "how it work", "explain", "working", "what is this", "about the project"):
        result["reply"] = ("A PIR sensor detects whether anyone is in the room and an ACS712 sensor measures the current "
                           "drawn by appliances. If the room has been empty for a set time while current is still "
                           "flowing, the ESP32 sounds a buzzer and flashes the LED to remind you. It also watches "
                           "voltage and temperature, cuts the relay on dangerous faults, and uploads everything to "
                           "this dashboard's database.")
        return result
    if _has(t, "component", "hardware", "sensor", "parts", "esp32") and not _has(t, "reading", "value"):
        result["reply"] = ("ESP32 (controller), HC-SR501 PIR (occupancy), ACS712 (current), ZMPT101B (voltage), "
                           "LM35 (temperature), relay module (load cut-off), buzzer + LED (alerts). Protection: "
                           "fuse, MCB, RCCB/RCBO and SPD.")
        return result
    if _has(t, "rccb", "rcbo", "mcb", "fuse", "spd", "shock", "earth leak"):
        result["reply"] = ("Real earth-leakage and shock protection comes from the RCCB/RCBO, short-circuit and "
                           "overload protection from the MCB/fuse, and surge protection from the SPD. The ESP32 "
                           "monitors and alerts on top of that - it does not replace them.")
        return result
    if _has(t, "tip", "save", "reduce", "advice", "suggest"):
        result["reply"] = ("1) Switch off lights/fans/TV/AC when leaving. 2) Set AC to 24-26 °C. 3) Use LED bulbs and "
                           "BEE 5-star appliances. 4) Unplug chargers and set-top boxes - standby power adds up. "
                           "5) Heed the buzzer: every minute of an empty room with the AC on is wasted money.")
        if r and r["load_on"] and not r["occupied"]:
            result["reply"] += " Right now the room is empty and appliances are still ON - you could switch them off."
        return result

    # --- everything below needs live data
    if r is None:
        result["reply"] = "I haven't received any data from the device yet. Check that the ESP32 (or the simulator) is running."
        return result

    stale = "" if r["online"] else f" (Note: device last reported {_ago(r['ts'])} - it may be offline.)"

    if _has(t, "why") and _has(t, "buzzer", "alarm", "beep", "alert", "sound"):
        if r["fault"]:
            result["reply"] = f"Safety fault: {FAULT_TEXT.get(r['fault'], r['fault'])}." + stale
        elif r["alert"]:
            result["reply"] = "The room is empty but appliances are still drawing current, so the reminder buzzer is on." + stale
        else:
            result["reply"] = "No alert is active right now." + stale
        return result

    if _has(t, "fault", "danger", "safe", "problem", "overheat", "abnormal"):
        if r["fault"]:
            result["reply"] = f"⚠ Active fault: {r['fault']} - {FAULT_TEXT.get(r['fault'], '')}." + stale
        else:
            result["reply"] = "All safety checks are normal: " + _status_line(r) + stale
        return result

    if _has(t, "alert", "event", "history", "log", "notification", "happened"):
        ev = db.events(5)
        if not ev:
            result["reply"] = "No events recorded yet."
        else:
            lines = [f"{e['kind']}: {e['detail']} ({_ago(e['ts'])})" for e in ev]
            result["reply"] = "Latest events - " + "; ".join(lines) + "."
        return result

    if _has(t, "waste", "wasted", "forgot", "unnecessary", "leak"):
        s = db.energy_stats(db.today_start(), DEVICE)
        result["reply"] = (f"Today {s['wasted_kwh']:.3f} kWh (about Rs {s['wasted_cost']:.2f}) was used while the room "
                           f"was empty, out of {s['kwh']:.3f} kWh total. {s['alerts']} reminder alert(s) so far.")
        return result

    if _has(t, "energy", "kwh", "unit", "cost", "bill", "consum", "usage", "spent"):
        s = db.energy_stats(db.today_start(), DEVICE)
        result["reply"] = (f"Today: {s['kwh']:.3f} kWh, about Rs {s['cost']:.2f} at Rs {s['tariff']:g}/unit. "
                           f"Of that, {s['wasted_kwh']:.3f} kWh was used in an empty room.")
        return result

    if _has(t, "status", "report", "summary", "overview", "update", "how is", "how's"):
        result["reply"] = _status_line(r) + (f" ⚠ Fault: {r['fault']}." if r["fault"] else "") \
            + (" 🔔 Reminder buzzer active." if r["alert"] else "") + stale
        return result

    if _has(t, "voltage", "volt"):
        result["reply"] = f"Mains voltage is {r['voltage']:.0f} V." + stale
        return result
    if _has(t, "current", "amp"):
        result["reply"] = f"Current draw is {r['current']:.2f} A." + stale
        return result
    if _has(t, "power", "watt"):
        result["reply"] = f"Power draw is about {r['power']:.0f} W." + stale
        return result
    if _has(t, "temp", "hot", "heat"):
        result["reply"] = f"Temperature is {r['temp']:.1f} °C." + stale
        return result
    if _has(t, "room", "occup", "empty", "anyone", "people", "motion", "someone", "present"):
        if r["occupied"]:
            result["reply"] = "Motion was detected recently, so the room is occupied." + stale
        else:
            extra = " Appliances are still ON!" if r["load_on"] else " Appliances are off - good."
            result["reply"] = "The room looks empty." + extra + stale
        return result
    if _has(t, "appliance", "load", "relay", "device"):
        result["reply"] = ("Appliances are drawing power. " if r["load_on"] else "No appliance is drawing power. ") \
            + f"Relay is {'connected' if r['relay'] else 'cut off'}." + stale
        return result
    result["reply"] = ("Sorry, I didn't catch that. Try 'status', 'energy today', 'any alerts?', "
                       "'tips to save power', or 'help'.")
    return result


# ----------------------------------------------------------------- LLM brain (optional)
def llm_reply(msg):
    r = snapshot()
    s = db.energy_stats(db.today_start(), DEVICE)
    context = {"latest_reading": r, "today": s, "recent_events": db.events(5)}
    body = json.dumps({
        "model": LLM_MODEL,
        "max_tokens": 300,
        "system": SYSTEM_PROMPT + "\n\nLIVE DATA:\n" + json.dumps(context, default=str),
        "messages": [{"role": "user", "content": msg}],
    }).encode()
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages", data=body,
        headers={"content-type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.load(resp)
    return data["content"][0]["text"].strip()


def reply(msg):
    msg = (msg or "").strip()[:500]
    if not msg:
        return {"reply": "Please type a question.", "action": None, "mode": "rules"}
    rules = rule_reply(msg)
    if rules["action"]:                        # control commands are always handled by deterministic rules
        rules["mode"] = "rules"
        return rules
    if API_KEY:
        try:
            return {"reply": llm_reply(msg), "action": None, "mode": "llm"}
        except Exception as e:                 # network/quota/etc. -> graceful fallback
            print("LLM error, using rules:", e)
    rules["mode"] = "rules"
    return rules
