"""SQLite storage + energy statistics."""
import os
import sqlite3
import time
from contextlib import contextmanager

DB_PATH = os.getenv("DB_PATH", os.path.join(os.path.dirname(__file__), "data.db"))
TARIFF = float(os.getenv("TARIFF_RS_PER_KWH", "7"))   # Rs per unit
MAX_GAP_S = 30                                         # ignore gaps longer than this when integrating energy


@contextmanager
def conn():
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    try:
        yield c
        c.commit()
    finally:
        c.close()


def init():
    with conn() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS readings(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts REAL NOT NULL, device_id TEXT NOT NULL,
            current REAL, voltage REAL, power REAL, temp REAL,
            occupied INTEGER, load_on INTEGER, alert INTEGER,
            fault TEXT, relay INTEGER);
        CREATE INDEX IF NOT EXISTS idx_readings_ts ON readings(ts);
        CREATE TABLE IF NOT EXISTS events(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts REAL NOT NULL, device_id TEXT NOT NULL,
            kind TEXT NOT NULL, detail TEXT);
        CREATE TABLE IF NOT EXISTS commands(
            device_id TEXT PRIMARY KEY, relay INTEGER NOT NULL DEFAULT 1);
        """)


def add_event(c, device_id, kind, detail=""):
    c.execute("INSERT INTO events(ts,device_id,kind,detail) VALUES(?,?,?,?)",
              (time.time(), device_id, kind, detail))


def save_reading(d):
    """Store a reading and log events when alert/fault state changes."""
    with conn() as c:
        prev = c.execute("SELECT alert, fault FROM readings WHERE device_id=? ORDER BY id DESC LIMIT 1",
                         (d["device_id"],)).fetchone()
        c.execute("""INSERT INTO readings(ts,device_id,current,voltage,power,temp,occupied,load_on,alert,fault,relay)
                     VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                  (time.time(), d["device_id"], d["current"], d["voltage"], d["power"], d["temp"],
                   d["occupied"], d["load_on"], d["alert"], d["fault"], d["relay"]))
        prev_alert = prev["alert"] if prev else 0
        prev_fault = prev["fault"] if prev else ""
        if d["alert"] and not prev_alert:
            add_event(c, d["device_id"], "ALERT", "Room empty but appliances still ON")
        if prev_alert and not d["alert"]:
            add_event(c, d["device_id"], "CLEARED", "Appliances switched off or room re-occupied")
        if d["fault"] and d["fault"] != prev_fault:
            add_event(c, d["device_id"], "FAULT", d["fault"])


def desired_relay(device_id):
    with conn() as c:
        r = c.execute("SELECT relay FROM commands WHERE device_id=?", (device_id,)).fetchone()
        return bool(r["relay"]) if r else True


def set_relay(device_id, on):
    with conn() as c:
        c.execute("INSERT INTO commands(device_id,relay) VALUES(?,?) "
                  "ON CONFLICT(device_id) DO UPDATE SET relay=excluded.relay", (device_id, int(on)))
        add_event(c, device_id, "RELAY", "Load switched " + ("ON" if on else "OFF") + " remotely")


def latest(device_id=None):
    with conn() as c:
        q = "SELECT * FROM readings " + ("WHERE device_id=? " if device_id else "") + "ORDER BY id DESC LIMIT 1"
        r = c.execute(q, (device_id,) if device_id else ()).fetchone()
        return dict(r) if r else None


def history(minutes=60, device_id=None, limit=720):
    since = time.time() - minutes * 60
    with conn() as c:
        q = "SELECT ts,current,voltage,power,temp,occupied,load_on,alert FROM readings WHERE ts>=? "
        args = [since]
        if device_id:
            q += "AND device_id=? "
            args.append(device_id)
        q += "ORDER BY ts"
        rows = [dict(r) for r in c.execute(q, args)]
    if len(rows) > limit:                                  # down-sample for the chart
        step = len(rows) / limit
        rows = [rows[int(i * step)] for i in range(limit)]
    return rows


def events(limit=20):
    with conn() as c:
        return [dict(r) for r in c.execute("SELECT * FROM events ORDER BY id DESC LIMIT ?", (limit,))]


def energy_stats(since_ts, device_id=None):
    """Integrate power over time -> kWh used, kWh wasted (room empty + load ON), alert count."""
    with conn() as c:
        q = "SELECT ts,power,occupied,load_on FROM readings WHERE ts>=? "
        args = [since_ts]
        if device_id:
            q += "AND device_id=? "
            args.append(device_id)
        rows = c.execute(q + "ORDER BY ts", args).fetchall()
        alerts = c.execute("SELECT COUNT(*) n FROM events WHERE kind='ALERT' AND ts>=?", (since_ts,)).fetchone()["n"]
    used = wasted = 0.0
    for a, b in zip(rows, rows[1:]):
        dt = b["ts"] - a["ts"]
        if dt <= 0 or dt > MAX_GAP_S:
            continue
        wh = (a["power"] or 0) * dt / 3600.0
        used += wh
        if not a["occupied"] and a["load_on"]:
            wasted += wh
    return {"kwh": used / 1000, "wasted_kwh": wasted / 1000,
            "cost": used / 1000 * TARIFF, "wasted_cost": wasted / 1000 * TARIFF,
            "alerts": alerts, "tariff": TARIFF}


def today_start():
    t = time.localtime()
    return time.mktime((t.tm_year, t.tm_mon, t.tm_mday, 0, 0, 0, 0, 0, -1))
