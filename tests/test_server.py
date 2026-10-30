import json
import tempfile
import threading
import unittest
from email.message import Message
from pathlib import Path
from unittest.mock import patch
from urllib.request import Request, urlopen as http_urlopen
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError

import server


class FakeDeviceResponse:
    def __init__(self, payload: bytes) -> None:
        self.payload = payload
        self.status = 200
        self.headers = Message()
        self.headers["Content-Type"] = "application/json; charset=utf-8"

    def __enter__(self) -> "FakeDeviceResponse":
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def read(self, size: int = -1) -> bytes:
        return self.payload[:size]


class DeviceLinkServerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temp_dir.name) / "records.sqlite3"
        self.database_patch = patch.object(server, "DATABASE_PATH", self.database_path)
        self.database_patch.start()
        server.initialize_database()

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.DeviceLinkHandler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.httpd.server_port}"

    def tearDown(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join()
        self.database_patch.stop()
        self.temp_dir.cleanup()

    def test_device_check_saves_response_and_records_endpoint_returns_it(self) -> None:
        payload = json.dumps({"temperature": 23.5, "humidity": 48}).encode("utf-8")
        with patch.object(server, "urlopen", return_value=FakeDeviceResponse(payload)):
            request = Request(f"{self.base_url}/api/check", method="POST")
            with http_urlopen(request) as response:
                saved = json.loads(response.read())

        self.assertEqual(response.status, 201)
        self.assertEqual(saved["record"]["payload"], payload.decode("utf-8"))
        self.assertEqual(saved["record"]["content_type"], "application/json; charset=utf-8")

        with http_urlopen(f"{self.base_url}/api/records?limit=10") as response:
            records = json.loads(response.read())["records"]

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["id"], saved["record"]["id"])
        self.assertEqual(records[0]["payload"], payload.decode("utf-8"))

    def test_records_endpoint_rejects_out_of_range_limit(self) -> None:
        with self.assertRaises(HTTPError) as context:
            http_urlopen(f"{self.base_url}/api/records?limit=1000")

        self.assertEqual(context.exception.code, 400)

    def test_saving_records_keeps_only_the_latest_configured_limit(self) -> None:
        with patch.object(server, "MAX_RECORDS", 2):
            server.save_sensor_record("text/plain", "first")
            server.save_sensor_record("text/plain", "second")
            server.save_sensor_record("text/plain", "third")

        records = server.get_sensor_records(10)
        self.assertEqual([record["payload"] for record in records], ["third", "second"])


if __name__ == "__main__":
    unittest.main()
