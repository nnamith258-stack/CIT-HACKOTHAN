# DeviceLink local console

1. Connect the computer to the ESP32 Wi-Fi network.
2. On Windows, double-click `start-local.bat`. Python 3 is required; no extra packages are needed.
3. Open `http://127.0.0.1:8000/` in your browser and choose **Continue to device console** to open the home dashboard.
4. Leave the home dashboard open; it checks the ESP32 every five seconds and saves each successful response locally. Use the refresh button to check immediately.

The local Python service stores successful responses as timestamped records in SQLite at `%LOCALAPPDATA%\DeviceLink\sensor_records.db` (normally under your Windows user profile). The dashboard shows the latest five records; the database retains the latest 10,000 records. The database is not served by the web server.

Records contain the ESP32 response body and content type as returned by `http://192.168.4.1/`. The dashboard polls every five seconds and updates readings in place (the card layout stays fixed). It recognizes JSON keys: `tank_percent` (0–100), `soil_moisture_percent` (0–100) and/or `soil_state`, `rain_state` or `rain_detected` (boolean), `controller_status`, `mode`, `irrigation_status`, `refill_status`, `irrigation_ack`, `refill_ack`, and `faults` (string, list of strings, or boolean). Until those keys are present, that reading stays unavailable rather than showing made-up data.

Start/stop irrigation and refill commands are intentionally disabled until the ESP32 command endpoints and acknowledgement format are known. No hardware commands are sent.

Automatic/manual selection and threshold/run-time values are local browser previews only; they are not sent to SQLite or the controller. A short list of local dashboard events is kept in this browser. To connect actual sensor readings or controls without changing firmware, provide the existing ESP32 response JSON and command paths/methods.

The sign-in screen is a UI preview only and does not provide authentication.

The dashboard language selector supports English, Kannada, and Hindi. The selection is saved in browser storage and applies to dashboard labels, controls, notices, generated statuses, notifications, and displayed timestamps. ESP32 response payloads and unknown device-provided text are kept as received.
