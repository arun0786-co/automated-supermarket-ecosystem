import pytest
from fastapi.testclient import TestClient

import main

CATALOG = {
    "PRD-001": {"name": "Banana", "category": "Produce", "price": 1.2, "emoji": "🍌"},
    "PRD-002": {"name": "Apple", "category": "Produce", "price": 0.8, "emoji": "🍎"},
    "DRY-003": {"name": "Greek Yogurt", "category": "Dairy", "price": 2.5, "emoji": "🫙"},
    "PNT-001": {"name": "Cereal Box", "category": "Pantry", "price": 4.5, "emoji": "🥣"},
    "PNT-005": {"name": "Oats 1kg", "category": "Pantry", "price": 3.0, "emoji": "🥣"},
    "SNK-001": {"name": "Dark Chocolate", "category": "Snacks", "price": 2.8, "emoji": "🍫"},
    "BVG-001": {"name": "Sparkling Water", "category": "Beverages", "price": 1.2, "emoji": "💧"},
    "PRD-004": {"name": "Avocado", "category": "Produce", "price": 1.5, "emoji": "🥑"},
}


@pytest.fixture
def client(monkeypatch):
    # stand-in for product-core so tests don't need the service running
    async def fake_catalog():
        return {sku: {"sku": sku, **p} for sku, p in CATALOG.items()}

    monkeypatch.setattr(main, "fetch_catalog", fake_catalog)
    return TestClient(main.app)


def item(sku):
    return {"sku": sku, "name": CATALOG[sku]["name"], "category": CATALOG[sku]["category"]}


def test_health(client):
    assert client.get("/api/health").json()["status"] == "ok"


def test_recommends_co_purchased_items_by_score(client):
    res = client.post("/api/recommendations", json={"userId": "USR-001", "cartItems": [item("PRD-001")]})
    skus = [r["sku"] for r in res.json()]
    assert skus == ["DRY-003", "PNT-001", "PNT-005"]


def test_never_recommends_items_already_in_cart(client):
    res = client.post("/api/recommendations", json={"userId": "USR-001", "cartItems": [item("PRD-001"), item("DRY-003")]})
    assert "DRY-003" not in [r["sku"] for r in res.json()]


def test_falls_back_to_trending_for_empty_cart(client):
    res = client.post("/api/recommendations", json={"userId": "USR-001", "cartItems": []})
    assert [r["reason"] for r in res.json()][0] == "top seller this week"


def test_respects_limit(client):
    res = client.post("/api/recommendations", json={"userId": "USR-001", "cartItems": [item("PRD-001")], "limit": 1})
    assert len(res.json()) == 1


def test_reason_comes_from_the_strongest_pairing(client):
    # apple -> yogurt scores 0.85, banana -> yogurt scores 0.92, so the banana reason wins
    # no matter which item was scanned first
    res = client.post("/api/recommendations", json={"userId": "USR-001", "cartItems": [item("PRD-002"), item("PRD-001")]})
    yogurt = next(r for r in res.json() if r["sku"] == "DRY-003")
    assert yogurt["reason"] == "commonly bought together"


def test_trending_endpoint(client):
    res = client.get("/api/recommendations/trending")
    assert [r["sku"] for r in res.json()] == ["BVG-001", "SNK-001", "DRY-003", "PRD-004"]
