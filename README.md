# VoltGuard — Smart Electricity Leakage Detection & Alert System

A GitHub-ready starter project for **Vercel + Supabase + Sarvam AI**.

## What this implements

- Dashboard for current, voltage, temperature, power, occupancy and appliance status.
- Recent electrical activity chart and event list.
- Sarvam AI chatbot connected from a server-side Python function.
- Supabase PostgreSQL storage for readings and events.
- ESP32-friendly `POST /api/readings` endpoint.
- Optional device-key check using `X-Device-Key`.

## Source alignment

The supplied abstract describes ESP32 with current, voltage and temperature sensors, alerts through buzzer and IoT dashboard, optional relay, and historical data. The IEEE paper additionally describes PIR occupancy sensing and the rule where a room is unoccupied while an appliance continues drawing current. This dashboard includes both sets of fields so the two documents are represented without treating them as identical.

## 1. Upload to GitHub

Upload the **contents** of this folder to the root of a new GitHub repository. The root should contain `api/`, `supabase/`, `index.html`, `style.css`, `app.js`, `requirements.txt` and `vercel.json`.

Never commit `.env` or a real API key. `.env.example` contains placeholders only.

## 2. Create Supabase database

1. Create a Supabase project.
2. Open SQL Editor.
3. Paste and run `supabase/schema.sql`.
4. In Project Settings → API, copy the Project URL and the `service_role` secret.
5. Keep the service-role key private. Do not put it in browser JavaScript.

## 3. Deploy on Vercel

1. Import the GitHub repository in Vercel.
2. Framework preset: Other.
3. Root Directory: `./` (repository root).
4. No build command is required.
5. Add these Environment Variables in Project Settings → Environment Variables:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SARVAM_API_KEY`
   - `SARVAM_MODEL` = `sarvam-105b`
   - `DEVICE_API_KEY` = a long random secret (optional but recommended for ESP32 writes)
6. Redeploy after adding variables.

The Python API function is `api/index.py`; the frontend files (`index.html`, `style.css`, `app.js`) are served from the repository root.

## 4. Test endpoints

- `GET /api/health` — checks whether server-side configuration exists.
- `GET /api/readings` — latest 30 readings.
- `GET /api/events` — latest 30 events.
- `POST /api/chat` — Sarvam chatbot.
- `POST /api/readings` — store an ESP32 reading.

Example chat body:
```json
{
  "messages": [
    {"role": "user", "content": "Explain how the PIR sensor helps detect electricity wastage."}
  ]
}
```

Example sensor payload:
```json
{
  "device_id": "room-1",
  "room": "Main Room",
  "current_a": 0.42,
  "voltage_v": 230.1,
  "temperature_c": 31.5,
  "power_w": 96.7,
  "occupied": false,
  "appliance_on": true,
  "buzzer_on": true,
  "led_on": true
}
```

Send the reading to `POST /api/readings` with `Content-Type: application/json` and, if configured, `X-Device-Key: YOUR_DEVICE_API_KEY`.

## Important prototype notes

- The 55°C, 190–250V, 10A and 0.08A values in `api/index.py` are illustrative software thresholds, not certified electrical safety limits. Calibrate sensors and validate the logic in a safe, supervised environment.
- Current/voltage sensor calibration, wiring, isolation and hardware protection are not implemented by this website.
- Software anomaly detection cannot prove that an electrical leakage exists.
- Never connect or modify live mains wiring as a student software task. Any mains-side assembly, measurement or switching must be designed and checked by a qualified electrician. A relay is not a substitute for fuse, MCB, RCCB/RCBO or surge protection.
- The dashboard starts with empty readings; it does not fabricate live sensor data. It will show values after your ESP32 or a simulator posts readings.
- The `commands` table is prepared for future relay-command workflow, but this starter does not issue physical relay commands.
