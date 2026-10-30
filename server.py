from __future__ import annotations

import json
import os
import sqlite3
import urllib.error
from contextlib import closing
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from urllib.request import urlopen


WEB_ROOT = Path(__file__).resolve().parent
APP_DATA = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "DeviceLink"
DATABASE_PATH = APP_DATA / "sensor_records.db"
DEVICE_URL = "http://192.168.4.1/"
MAX_RESPONSE_BYTES = 1_000_000
MAX_RECORDS = 10_000


def initialize_database() -> None:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(DATABASE_PATH)) as connection:
        with connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS sensor_records (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    recorded_at TEXT NOT NULL,
                    content_type TEXT NOT NULL,
                    payload TEXT NOT NULL
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_sensor_records_recorded_at "
                "ON sensor_records(recorded_at DESC)"
            )


def save_sensor_record(content_type: str, payload: str) -> dict[str, int | str]:
    recorded_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with closing(sqlite3.connect(DATABASE_PATH)) as connection:
        with connection:
            cursor = connection.execute(
                """
                INSERT INTO sensor_records (recorded_at, content_type, payload)
                VALUES (?, ?, ?)
                """,
                (recorded_at, content_type, payload),
            )
            record_id = cursor.lastrowid
            connection.execute(
                """
                DELETE FROM sensor_records
                WHERE id NOT IN (
                    SELECT id FROM sensor_records
                    ORDER BY id DESC
                    LIMIT ?
                )
                """,
                (MAX_RECORDS,),
            )

    return {
        "id": record_id,
        "recorded_at": recorded_at,
        "content_type": content_type,
        "payload": payload,
    }


def get_sensor_records(limit: int) -> list[dict[str, int | str]]:
    with closing(sqlite3.connect(DATABASE_PATH)) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            """
            SELECT id, recorded_at, content_type, payload
            FROM sensor_records
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [dict(row) for row in rows]


class DeviceLinkHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: object, **kwargs: object) -> None:
        super().__init__(*args, directory=str(WEB_ROOT), **kwargs)

    def send_json(self, status: int, data: dict[str, object]) -> None:
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        request = urlsplit(self.path)
        if request.path == "/api/records":
            query = parse_qs(request.query)
            try:
                limit = int(query.get("limit", ["50"])[0])
            except ValueError:
                self.send_json(400, {"error": "Record limit must be a number."})
                return

            if not 1 <= limit <= 100:
                self.send_json(400, {"error": "Record limit must be between 1 and 100."})
                return

            self.send_json(200, {"records": get_sensor_records(limit)})
            return

        if request.path.startswith("/api/"):
            self.send_json(404, {"error": "API endpoint not found."})
            return

        super().do_GET()

    def do_POST(self) -> None:
        request = urlsplit(self.path)
        if request.path != "/api/check":
            self.send_json(404, {"error": "API endpoint not found."})
            return

        try:
            with urlopen(DEVICE_URL, timeout=8) as device_response:
                content_type = device_response.headers.get("Content-Type", "text/plain")
                body = device_response.read(MAX_RESPONSE_BYTES + 1)
                if len(body) > MAX_RESPONSE_BYTES:
                    self.send_json(502, {"error": "The ESP32 response exceeded the 1 MB limit."})
                    return

                charset = device_response.headers.get_content_charset() or "utf-8"
                payload = body.decode(charset, errors="replace")
        except urllib.error.HTTPError as error:
            self.send_json(502, {"error": f"The ESP32 returned HTTP {error.code}."})
            return
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            reason = error.reason if isinstance(error, urllib.error.URLError) else error
            self.send_json(502, {"error": f"Could not reach the ESP32: {reason}"})
            return

        record = save_sensor_record(content_type, payload)
        self.send_json(201, {"record": record})


def main() -> None:
    initialize_database()
    address = ("127.0.0.1", 8000)
    with ThreadingHTTPServer(address, DeviceLinkHandler) as server:
        print(f"DeviceLink is running at http://{address[0]}:{address[1]}/")
        print(f"SQLite records: {DATABASE_PATH}")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nDeviceLink stopped.")


if __name__ == "__main__":
    main()
