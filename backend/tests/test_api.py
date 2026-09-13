"""End-to-end API tests against a temporary SQLite DB, ingesting the real corpus when present."""
import os
from pathlib import Path

import pytest

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_api.db")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="module")
def client(mod_root: Path):
    for f in Path(".").glob("test_api.db*"):
        f.unlink()
    with TestClient(app) as c:
        r = c.post("/api/projects", json={"name": "test", "modRoot": str(mod_root)})
        assert r.status_code == 201, r.text
        pid = r.json()["id"]
        c.post(f"/api/projects/{pid}/activate")  # startup may have seeded another project from .env
        r = c.post(f"/api/projects/{pid}/ingest")
        assert r.status_code == 200, r.text
        assert r.json()["added"] > 800
        yield c
    from app.db import engine
    engine.dispose()  # release the SQLite file so Windows lets us delete it
    for f in Path(".").glob("test_api.db*"):
        try:
            f.unlink()
        except PermissionError:
            pass


def test_entity_listing_and_detail(client):
    r = client.get("/api/entities", params={"entity_type": "CapitalShip"})
    assert r.status_code == 200 and len(r.json()) == 35
    r = client.get("/api/entities/Capital_COV_Avenar_Regr")
    body = r.json()
    assert body["typed"]["weapon_count"] == 5
    assert len(body["weapons"]) == 5
    assert body["schema"]["entityType"] == "CapitalShip"
    assert any(n["k"] == "Weapon" for n in body["tree"]["root"])


def test_text_roundtrip_matches_disk(client, gameinfo):
    r = client.get("/api/entities/Frigate_UNSC_Able_Cole/text")
    assert r.text == (gameinfo / "Frigate_UNSC_Able_Cole.entity").read_bytes().decode("utf-8")


def test_edit_and_revert(client):
    r = client.post("/api/entities/Frigate_UNSC_Able_Cole/edits",
                    json={"changes": [{"op": "set", "path": "MaxHullPoints", "value": 999}]})
    assert r.status_code == 200, r.text
    assert r.json()["isDirty"] is True and r.json()["typed"]["hull"] == 999.0
    text = client.get("/api/entities/Frigate_UNSC_Able_Cole/text").text
    assert "MaxHullPoints 999.0\n" in text
    r = client.post("/api/entities/Frigate_UNSC_Able_Cole/revert")
    assert r.json()["isDirty"] is False and r.json()["typed"]["hull"] == 350.0


def test_references_and_diagnostics(client):
    refs = client.get("/api/entities/Capital_COV_Avenar_Regr/references").json()
    kinds = {r["kind"] for r in refs}
    assert {"entity", "string", "sound", "particle", "mesh"} <= kinds
    incoming = client.get("/api/entities/Research_Cov_Combat_Avenar_Unlock_Regr/referenced-by").json()
    assert any(i["source"]["name"] == "Capital_COV_Avenar_Regr" for i in incoming)
    summary = client.get("/api/diagnostics/summary").json()
    assert summary["bySeverity"].get("warning", 0) > 0
    codes = {c["code"] for c in summary["byCode"]}
    assert {"MISSING_STRING", "RESEARCH_POS_COLLISION", "DUPLICATE_STRING"} <= codes


def test_analytics_and_balance(client):
    d = client.get("/api/analytics/distribution", params={"entity_type": "Frigate", "path": "maxSpeedLinear"}).json()
    assert d["overall"]["count"] > 100
    peers = client.get("/api/entities/Frigate_UNSC_Able_Cole/peers").json()
    assert peers["peers"] > 5 and any(m["metric"] == "dps_per_cost" for m in peers["metrics"])
    recs = client.get("/api/balance/recommendations", params={"category": "ship"}).json()
    assert recs["groups"] and isinstance(recs["recommendations"], list)
    tree = client.get("/api/graph/research/Player_UNSC_Cole").json()
    assert len(tree["nodes"]) > 50 and tree["edges"]


def test_strings_and_csv(client):
    r = client.get("/api/strings", params={"search": "Avenar"}).json()
    assert r["rows"]
    csv = client.get("/api/export/csv/Frigate").text
    assert csv.splitlines()[0].startswith("name,displayName")
    assert len(csv.splitlines()) == 106


def test_relationship_graph_and_layout(client):
    r = client.get("/api/graph/relationships?categories=ship")
    assert r.status_code == 200
    g = r.json()
    core = [n for n in g["nodes"] if not n["proxy"]]
    proxies = [n for n in g["nodes"] if n["proxy"]]
    assert core and proxies, "ships link to research/abilities outside the pathway, so proxies must appear"
    assert all(n["category"] == "ship" for n in core)
    assert all(e["source"] in {n["id"] for n in core} for e in g["edges"])
    artemis = next(n for n in core if n["id"] == "Capital_UNSC_Artemis_Cole")
    assert any(p["path"] == "ability:0" and p["target"] is None for p in artemis["ports"]), "empty ability slots are free ports"
    # focus mode follows references downstream; asset wires fan out for the asset_focus node only
    f = client.get("/api/graph/relationships?focus=Capital_UNSC_Artemis_Cole&depth=1&asset_kinds=mesh").json()
    ids = {n["id"] for n in f["nodes"]}
    assert "Capital_UNSC_Artemis_Cole" in ids and not any(n.get("asset") for n in f["nodes"])
    f = client.get("/api/graph/relationships?focus=Capital_UNSC_Artemis_Cole&depth=1&asset_kinds=mesh,brush&asset_focus=Capital_UNSC_Artemis_Cole").json()
    assets = [n for n in f["nodes"] if n.get("asset")]
    assert assets and all(n["ports"] == [] for n in assets)
    merged = [e for e in f["edges"] if e["kind"] != "entity"]
    assert merged and all(e["source"] == "Capital_UNSC_Artemis_Cole" and e["count"] == len(e["paths"]) for e in merged)
    assert next(n for n in f["nodes"] if n["id"] == "Capital_UNSC_Artemis_Cole")["assetCounts"].get("mesh", 0) >= 1
    # layouts round-trip and merge
    assert client.put("/api/graph/layout/test", json={"positions": {"A": {"x": 1, "y": 2}}}).status_code == 200
    client.put("/api/graph/layout/test", json={"positions": {"B": {"x": 3, "y": 4}}})
    assert client.get("/api/graph/layout/test").json()["positions"] == {"A": {"x": 1, "y": 2}, "B": {"x": 3, "y": 4}}
    assert client.delete("/api/graph/layout/test").status_code == 204
    assert client.get("/api/graph/layout/test").json()["positions"] == {}
