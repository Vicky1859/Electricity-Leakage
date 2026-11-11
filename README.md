# VoltGuard — Smart Electricity Leakage Detection & Alert System

A beginner-friendly Flask + ESP32 project based on the team's micro-project abstract and IEEE write-up. It includes a live-style dashboard, SQLite history, demo sensor readings, alert logic, and VoltAssist chatbot.

## Features

- Dashboard for current, voltage, temperature, room occupancy, and appliance status
- Recent activity table and current-reading chart
- Rule-based alerts for possible electricity wastage, high temperature, and unusual voltage
- VoltAssist chatbot for project and dashboard questions
- REST endpoint for ESP32 sensor telemetry
- SQLite database for reading history
- Demo mode so the website can be demonstrated before hardware is connected

## Project structure

```text
smart-electricity-leakage-project/
├── app.py
├── requirements.txt
├── README.md
├── templates/
│   └── index.html
├── static/
│   ├── css/style.css
│   └── js/app.js
└── esp32/
    └── voltguard_esp32.ino
```

## Run on Windows

1. Install Python 3.10 or newer.
2. Download or clone this repository.
3. Open the project folder in VS Code.
4. Open the VS Code terminal / PowerShell and run:

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

5. Open **http://127.0.0.1:5000** in your browser.
6. Click **Simulate reading** to create new sample sensor data.
7. Open the chatbot button in the bottom-right corner and ask a question.

If PowerShell blocks activation, use this command for the current terminal session:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.venv\Scripts\Activate.ps1
```

## ESP32 connection (telemetry)

The `esp32/voltguard_esp32.ino` sketch is a starting point. Update the Wi-Fi name, password, and server URL. The server URL must use your computer's local network IP address, not `127.0.0.1`, when the ESP32 is sending data over Wi-Fi.

The firmware currently contains placeholder values for current, voltage, and temperature. It demonstrates the HTTP data format but is **not a calibrated sensor driver**. Complete sensor calibration and safe installation with qualified supervision before relying on hardware readings.

### POST endpoint

`POST /api/readings`

Example JSON:

```json
{
  "current": 0.65,
  "voltage": 230.0,
  "temperature": 31.5,
  "occupied": false,
  "appliance_on": true
}
```

The server responds with the alert decision and saves the reading in SQLite.

## Alert logic

The starter demo uses these configurable software rules:

- `WASTAGE`: room is unoccupied, appliance is on, and current is above 0.08 A
- `TEMPERATURE WARNING`: temperature is 55°C or higher
- `VOLTAGE WARNING`: voltage is below 190 V or above 250 V
- `NORMAL`: none of the above conditions are met

These are demonstration thresholds only. They are not electrical standards, fault diagnosis, or certified protection settings. Calibrate sensors and thresholds for the actual hardware and use certified protective devices.

## GitHub upload

1. Create a new GitHub repository, for example `smart-electricity-leakage-detector`.
2. Extract this ZIP.
3. In the repository page choose **Add file → Upload files** and upload the project files/folders, or use Git:

```bash
git init
git add .
git commit -m "Initial VoltGuard project"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/smart-electricity-leakage-detector.git
git push -u origin main
```

## Important safety note

This is an educational monitoring prototype, not a replacement for a fuse, MCB, RCCB/RCBO, surge protection, or a certified electrical safety system. Never work on live mains wiring. Do not use the relay output to switch mains loads as a beginner exercise. Mains-side design, installation, and testing must be handled by a qualified electrician.
