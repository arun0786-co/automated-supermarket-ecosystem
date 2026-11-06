import pytest
from fastapi.testclient import TestClient

import main
from model import Trainer

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
    # a fresh model per test, nothing learned in one test leaks into another
    monkeypatch.setattr(main, "trainer", Trainer(main.CO_PURCHASE_MATRIX, retrain_every=1))
    return TestClient(main.app)


def item(sku):
    return {"sku": sku, "name": CATALOG[sku]["name"], "category": CATALOG[sku]["category"]}


def test_health(client):
    assert client.get("/api/health").json()["status"] == "ok"


def test_recommends_co_purchased_items(client):
    res = client.post("/api/recommendations", json={"userId": "USR-001", "cartItems": [item("PRD-001")], "limit": 3})
    assert {r["sku"] for r in res.json()} == {"DRY-003", "PNT-001", "PNT-005"}


def test_results_are_the_same_on_every_start(client):
    body = {"userId": "USR-001", "cartItems": [item("PRD-001")], "limit": 3}
    first = client.post("/api/recommendations", json=body).json()
    main.trainer = Trainer(main.CO_PURCHASE_MATRIX)
    assert client.post("/api/recommendations", json=body).json() == first


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


def test_model_status_is_honest_about_its_training_data(client):
    assert client.get("/api/recommendations/model").json()["trainedOn"] == "synthetic"
    for _ in range(3):
        assert client.post("/api/events/purchase", json={"skus": ["PRD-001", "SNK-001"]}).status_code == 202
    body = client.get("/api/recommendations/model").json()
    assert body["trainedOn"] == "mixed"
    assert body["realBaskets"] == 3


def test_real_purchases_change_what_gets_recommended(client):
    request = {"userId": "USR-001", "cartItems": [item("PRD-001")], "limit": 1}
    assert client.post("/api/recommendations", json=request).json()[0]["sku"] != "SNK-001"
    for _ in range(100):
        client.post("/api/events/purchase", json={"skus": ["PRD-001", "SNK-001"]})
    assert client.post("/api/recommendations", json=request).json()[0]["sku"] == "SNK-001"


def test_feedback_moves_an_item_up_in_that_context_only(client):
    evening = {"aisle": 4, "hour": 18, "cartCategories": ["Produce"]}
    morning = {"aisle": 1, "hour": 8, "cartCategories": ["Produce"]}
    def top(context):
        res = client.post("/api/recommendations", json={"userId": "U", "cartItems": [item("PRD-001")], "limit": 3, "context": context})
        return res.json()[0]["sku"]

    for _ in range(60):
        assert client.post("/api/recommendations/feedback", json={"sku": "PNT-005", "reward": 1, "context": evening}).status_code == 204
        client.post("/api/recommendations/feedback", json={"sku": "DRY-003", "reward": 0, "context": evening})
        client.post("/api/recommendations/feedback", json={"sku": "PNT-001", "reward": 0, "context": evening})
        client.post("/api/recommendations/feedback", json={"sku": "PNT-005", "reward": 0, "context": morning})
        client.post("/api/recommendations/feedback", json={"sku": "DRY-003", "reward": 1, "context": morning})
    assert top(evening) == "PNT-005"
    assert top(morning) == "DRY-003"


def test_feedback_only_accepts_a_real_reward(client):
    assert client.post("/api/recommendations/feedback", json={"sku": "PNT-005", "reward": 5}).status_code == 422


def test_a_limit_the_model_cannot_fill_is_topped_up_without_repeats(client):
    res = client.post("/api/recommendations", json={"userId": "U", "cartItems": [item("SNK-001")], "limit": 6}).json()
    skus = [r["sku"] for r in res]
    assert len(skus) == len(set(skus))
    assert "SNK-001" not in skus


@pytest.mark.parametrize("limit", [0, -1, 100000])
def test_silly_limits_are_refused(client, limit):
    res = client.post("/api/recommendations", json={"userId": "U", "cartItems": [], "limit": limit})
    assert res.status_code == 422


def test_catalog_down_returns_nothing_rather_than_failing(client, monkeypatch):
    async def down():
        return {}
    monkeypatch.setattr(main, "fetch_catalog", down)
    res = client.post("/api/recommendations", json={"userId": "U", "cartItems": [item("PRD-001")]})
    assert res.status_code == 200
    assert res.json() == []
