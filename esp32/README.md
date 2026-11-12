# ESP32 telemetry integration notes

The backend accepts JSON at `POST https://YOUR-VERCEL-DOMAIN/api/readings`.

Required JSON fields are documented in the main README. Add the device secret as the `X-Device-Key` request header if `DEVICE_API_KEY` is configured in Vercel.

This repository intentionally does not provide mains-side wiring instructions or a ready-to-run switching sketch. Sensor calibration, isolation, power supply design and any connection to mains equipment must be handled and checked by a qualified electrician. You can test the API using simulated JSON readings first.
