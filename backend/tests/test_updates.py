"""Update pipeline against a local stand-in for the GitHub Releases API: check, download, hash check, signature gate."""
import hashlib
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

from app.services import update_service as us


@pytest.fixture
def fake_github(tmp_path):
    installer = b"MZ" + b"\x00" * 4096            # not a real PE, so its Authenticode status is NotSigned
    digest = hashlib.sha256(installer).hexdigest()

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):  # quiet
            pass

        def do_GET(self):
            base = f"http://127.0.0.1:{self.server.server_port}"
            if self.path.endswith("/releases/latest"):
                body = json.dumps({"tag_name": "v9.9.9", "body": "notes from github", "html_url": base + "/rel",
                                   "assets": [{"name": "SOTP-Dev-Env-Setup-9.9.9.exe", "browser_download_url": base + "/dl/setup.exe",
                                               "size": len(installer), "digest": "sha256:" + digest},
                                              {"name": "latest.json", "browser_download_url": base + "/dl/latest.json"}]}).encode()
            elif self.path == "/dl/latest.json":
                body = json.dumps({"version": "9.9.9", "sha256": digest, "notes": "notes from manifest"}).encode()
            elif self.path == "/dl/setup.exe":
                body = installer
            else:
                self.send_response(404); self.end_headers(); return
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}", digest
    srv.shutdown()


def _wait(svc, states=("ready", "failed"), timeout=10):
    for _ in range(int(timeout / 0.05)):
        if svc.status()["state"] in states:
            return svc.status()
        time.sleep(0.05)
    raise AssertionError(f"download stuck in {svc.status()['state']}")


def test_check_download_and_signature_gate(fake_github, tmp_path, monkeypatch):
    base, digest = fake_github
    monkeypatch.setattr(us, "API", base + "/repos/{repo}/releases/latest")
    svc = us.UpdateService(tmp_path, "x/y", allow_unsigned=False)
    info = svc.check(force=True)
    assert info["available"] is True and info["latest"] == "9.9.9" and info["sha256"] == digest
    assert info["notes"] == "notes from manifest"           # latest.json wins over the release body
    svc.start_download()
    st = _wait(svc)
    assert st["state"] == "failed" and "signature" in st["error"]   # unsigned installers are refused by default
    assert not list((tmp_path / "updates").glob("*.exe"))          # and discarded

    svc = us.UpdateService(tmp_path, "x/y", allow_unsigned=True)
    svc.check(force=True)
    svc.start_download()
    st = _wait(svc)
    assert st["state"] == "ready" and st["signature"] != "Valid"   # a fake PE reports NotSigned or UnknownError
    assert Path(st["path"]).stat().st_size == 4098
    assert svc.install()["ok"] is False                             # never from a dev process


def test_hash_mismatch_is_rejected(fake_github, tmp_path, monkeypatch):
    base, _ = fake_github
    monkeypatch.setattr(us, "API", base + "/repos/{repo}/releases/latest")
    svc = us.UpdateService(tmp_path, "x/y", allow_unsigned=True)
    svc.check(force=True)
    svc.info.sha256 = "0" * 64
    svc.start_download()
    st = _wait(svc)
    assert st["state"] == "failed" and "sha256" in st["error"]


def test_no_releases_yet_is_not_an_error(tmp_path, monkeypatch):
    monkeypatch.setattr(us, "API", "http://127.0.0.1:9/repos/{repo}/releases/latest")   # connection refused
    svc = us.UpdateService(tmp_path, "x/y")
    info = svc.check(force=True)
    assert info["available"] is False and info["error"]           # network failure is reported
    assert us.parse_version("v2.10.0") > us.parse_version("2.9.9")


def test_signature_verdict_pins_our_certificate():
    pinned = {"DAF55CA614C0AC605B072491C8FEE55F2AA3FCE7"}
    assert us.signature_verdict("Valid", None, pinned) == "Valid"
    assert us.signature_verdict("UnknownError", "daf55ca614c0ac605b072491c8fee55f2aa3fce7", pinned) == "Pinned"
    assert us.signature_verdict("UnknownError", "0" * 40, pinned) == "UnknownError"     # someone else's self-signed cert
    assert us.signature_verdict("HashMismatch", "DAF55CA614C0AC605B072491C8FEE55F2AA3FCE7", pinned) == "HashMismatch"
    assert us.signature_verdict("NotSigned", None, pinned) == "NotSigned"


DEV_BUILD = sorted((Path(__file__).resolve().parents[2] / "desktop" / "dist").glob("SOTP-Dev-Env-Setup-*.exe"))


@pytest.mark.skipif(not DEV_BUILD, reason="no locally built installer")
def test_dev_signed_installer_is_pinned_and_tampering_is_caught(tmp_path):
    from app.config import settings
    status, thumb = us.authenticode_status(DEV_BUILD[-1])
    assert us.signature_verdict(status, thumb, set(settings.update_signers)) == "Pinned"
    bad = tmp_path / "tampered.exe"
    data = bytearray(DEV_BUILD[-1].read_bytes())
    data[len(data) // 2] ^= 0xFF
    bad.write_bytes(bytes(data))
    status, thumb = us.authenticode_status(bad)
    assert us.signature_verdict(status, thumb, set(settings.update_signers)) not in ("Valid", "Pinned")
