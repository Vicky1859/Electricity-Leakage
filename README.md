# VoltGuard — Smart Electricity Leakage Detection & Alert System

VoltGuard is a student educational prototype with a responsive monitoring dashboard, sample sensor readings, alert rules, SQLite reading history, an ESP32 telemetry endpoint, and **VoltAssist powered by the Groq API**.

## What works in this version

- Dashboard cards for current, voltage, temperature, occupancy, and appliance state
- Current history chart and recent-reading table
- Demo reading generator for presentations
- Rule-based example alerts (possible wastage, temperature, and voltage)
- AI chatbot using Groq chat completions, with short conversation context and latest dashboard readings
- REST API for ESP32 telemetry
- Optional bearer-token protection for device telemetry
- Vercel-ready Flask app and public static assets

## 1. Run locally on Windows PowerShell

Install Python 3.10+ and then:

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
notepad .env
```

Create your own Groq API key in the Groq Console and put it in `.env`:

```env
GROQ_API_KEY=your_real_key_goes_here
GROQ_MODEL=llama-3.3-70b-versatile
```

Do not share the key in chat, screenshots, or GitHub. `.env` is ignored by Git. Then run:

```powershell
python app.py
```

Open http://127.0.0.1:5000. The dashboard and demo readings work without a Groq key; AI chat needs the key.

## 2. Push the project to GitHub

1. Create a new empty repository on GitHub.
2. Open PowerShell inside this project folder.
3. Run:

```powershell
git init
git add .
git commit -m "Add VoltGuard dashboard and Groq AI chatbot"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
git push -u origin main
```

Replace the repository URL with your own. Check that `.env` is not in the files being committed.

## 3. Deploy to Vercel

1. Sign in to Vercel and choose **Add New → Project**.
2. Import the GitHub repository you just created.
3. Keep the detected Python/Flask settings; the project exports `app` from root `app.py`.
4. Before deploying (or immediately after importing), open **Project → Settings → Environment Variables**.
5. Add `GROQ_API_KEY` with your private Groq key. Add `GROQ_MODEL` with `llama-3.3-70b-versatile` (optional; this is the default).
6. Select Production, Preview, and Development as needed, save, and deploy/redeploy.
7. Open the Vercel deployment URL and test the dashboard and VoltAssist chatbot.

Vercel environment variable changes apply to new deployments, so redeploy after editing them.

## 4. ESP32 telemetry

The endpoint is:

```text
POST https://YOUR-VERCEL-DOMAIN/api/device/readings
Content-Type: application/json
Authorization: Bearer YOUR_DEVICE_API_TOKEN
```

Example JSON body:

```json
{
  "current": 0.42,
  "voltage": 230.0,
  "temperature": 32.5,
  "occupied": true,
  "appliance_on": true
}
```

For device authentication, create a long random `DEVICE_API_TOKEN` environment variable in Vercel and configure the same token in your ESP32 firmware. If `DEVICE_API_TOKEN` is not configured, the endpoint accepts telemetry without a token (useful only for a private local demo). Do not put the Groq API key in ESP32 firmware.

The existing `/api/readings` endpoint is retained for local demonstrations. Use `/api/device/readings` for device submissions.

## Important hosting note about data persistence

This starter uses SQLite to keep the project simple. On Vercel, the database is placed under `/tmp`, which is temporary serverless storage and may reset or differ between function instances. It is suitable for a demonstration, **not permanent multi-user history**. For durable deployed history, connect a managed PostgreSQL database (for example, Neon or Vercel Postgres) and migrate the reading table before relying on saved readings.

## Sensor and electrical safety

The ESP32 sketch contains demonstration sensor values and is not a calibrated sensor driver. The dashboard's example thresholds (55 °C, below 190 V or above 250 V, and unoccupied + appliance on + current above 0.08 A) are not certified safety limits. This student prototype is not a certified leakage detector or protective device. Never work on live mains wiring or rely on this website to protect people or property. Any mains-side installation and testing must be handled by a qualified electrician with appropriate supervision and certified protection equipment.

## Project structure

```text
smart-electricity-leakage-project/
├── app.py
├── requirements.txt
├── .env.example
├── .gitignore
├── README.md
├── templates/index.html
├── public/
│   ├── css/style.css
│   └── js/app.js
├── static/                 # source copies for convenient local editing
└── esp32/voltguard_esp32.ino
```
