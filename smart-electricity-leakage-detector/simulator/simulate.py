"""Fake ESP32 for demos/testing without hardware.

Usage:  python simulate.py [--server http://localhost:5000] [--key changeme] [--interval 2] [--fast]

Cycle (repeats): person in room, fan+light ON  ->  person leaves, appliances stay ON (alert!)
                 -> appliances switched OFF -> idle -> occasional over-current fault.
It also obeys the relay state returned by the server, just like the real firmware.
"""
import argparse
import random
import time

import requests

ap = argparse.ArgumentParser()
ap.add_argument("--server", default="http://localhost:5000")
ap.add_argument("--key", default="changeme")
ap.add_argument("--device", default="room-1")
ap.add_argument("--interval", type=float, default=2.0)
ap.add_argument("--fast", action="store_true", help="shorter phases (good for a live demo)")
a = ap.parse_args()

k = 0.4 if a.fast else 1.0
# (name, seconds, occupied, appliance_amps, fault)
PHASES = [
    ("room in use",          int(30 * k), 1, 0.9, ""),
    ("left, appliances ON",  int(45 * k), 0, 0.9, ""),     # triggers the buzzer after ALERT_AFTER
    ("appliances OFF",       int(20 * k), 0, 0.0, ""),
    ("room in use",          int(20 * k), 1, 1.4, ""),
    ("overload fault",       int(10 * k), 1, 11.0, "OVER_CURRENT"),
    ("appliances OFF",       int(15 * k), 0, 0.0, ""),
]
ALERT_AFTER = 15 * k
relay_wanted = True


def run():
    global relay_wanted
    while True:
        for name, secs, occ, amps, fault in PHASES:
            print(f"--- {name}")
            start = time.time()
            while time.time() - start < secs:
                relay = relay_wanted and not fault
                i = amps * random.uniform(0.97, 1.03) if relay else 0.0
                v = random.gauss(230, 1.5)
                load_on = i > 0.15
                alert = (not occ) and load_on and (time.time() - start) > ALERT_AFTER
                p = {
                    "device_id": a.device, "current": round(i, 3), "voltage": round(v, 1),
                    "power": round(i * v, 1), "temp": round(random.gauss(31 + i * 1.5, 0.3), 1),
                    "occupied": occ, "load_on": load_on, "alert": alert, "fault": fault, "relay": relay,
                }
                try:
                    r = requests.post(a.server + "/api/telemetry", json=p, headers={"X-Device-Key": a.key}, timeout=4)
                    if r.ok:
                        relay_wanted = r.json().get("relay", True)
                    else:
                        print("server said", r.status_code, r.text)
                except requests.RequestException as e:
                    print("cannot reach server:", e)
                time.sleep(a.interval)


if __name__ == "__main__":
    try:
        run()
    except KeyboardInterrupt:
        pass
