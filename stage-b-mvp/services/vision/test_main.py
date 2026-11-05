import base64
import io
import os

import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

import main
from detector import FrameError, OnnxDetector, best_score_per_class, crop_roi, decode_frame, preprocess


def encoded_frame(size=(32, 24)) -> str:
    buffer = io.BytesIO()
    Image.new("RGB", size, (200, 180, 40)).save(buffer, format="JPEG")
    return base64.b64encode(buffer.getvalue()).decode()


class StubDetector:
    """answers each frame in turn"""

    def __init__(self, *answers):
        self.answers = iter(answers)

    def detect(self, _image):
        return next(self.answers)


@pytest.fixture
def client(monkeypatch):
    async def weight(sku):
        return {"PRD-001": 150.0, "PNT-001": 450.0}.get(sku)

    monkeypatch.setattr(main, "fetch_catalog_weight", weight)
    main.app.state.detector = None
    return TestClient(main.app)


def burst(client, delta=150, count=5):
    return client.post("/api/vision/scan", json={"weightDelta": delta, "frames": [encoded_frame()] * count})


def test_majority_of_the_burst_decides(client):
    main.app.state.detector = StubDetector(
        {"banana": 0.9}, {"banana": 0.8}, {"apple": 0.99}, {"banana": 0.7}, {}
    )
    body = burst(client).json()
    assert body["sku"] == "PRD-001"
    assert body["confidence"] == pytest.approx(0.8)
    assert body["accepted"] is True
    assert body["fusionProbability"] > 0.99
    assert body["source"] == "model"


def test_camera_right_but_scale_wrong_is_rejected(client):
    main.app.state.detector = StubDetector(*[{"banana": 0.9}] * 5)
    body = burst(client, delta=1000).json()
    assert body["accepted"] is False
    assert body["reason"] == "weight mismatch"


def test_nothing_seen_is_no_detection(client):
    main.app.state.detector = StubDetector(*[{}] * 5)
    body = burst(client).json()
    assert (body["accepted"], body["reason"], body["sku"]) == (False, "no detection", None)


def test_class_with_no_catalog_item_is_unknown(client):
    main.app.state.detector = StubDetector(*[{"teddy bear": 0.9}] * 5)
    body = burst(client).json()
    assert (body["accepted"], body["reason"], body["sku"]) == (False, "unknown item", None)


def test_bad_base64_is_a_400(client):
    main.app.state.detector = StubDetector({})
    response = client.post("/api/vision/scan", json={"weightDelta": 150, "frames": ["not base64!!"]})
    assert response.status_code == 400


def test_valid_base64_that_is_not_an_image_is_a_400(client):
    main.app.state.detector = StubDetector({})
    junk = base64.b64encode(b"this is not a picture").decode()
    assert client.post("/api/vision/scan", json={"weightDelta": 150, "frames": [junk]}).status_code == 400


def test_more_frames_than_a_burst_is_refused(client):
    main.app.state.detector = StubDetector(*[{}] * 6)
    assert burst(client, count=6).status_code == 422


def test_frames_without_a_model_are_refused_not_guessed(client):
    response = burst(client)
    assert response.status_code == 503
    assert response.json()["detail"] == "no vision model loaded"


def test_simulated_detection_is_labelled(client):
    body = client.post(
        "/api/vision/scan",
        json={"weightDelta": 450, "detection": {"sku": "PNT-001", "confidence": 0.85}},
    ).json()
    assert (body["accepted"], body["source"]) == (True, "simulated")
    assert body["fusionProbability"] > 0.99


def test_simulated_low_confidence_is_rejected(client):
    body = client.post(
        "/api/vision/scan",
        json={"weightDelta": 450, "detection": {"sku": "PNT-001", "confidence": 0.4}},
    ).json()
    assert (body["accepted"], body["reason"]) == (False, "low confidence")


def test_sku_not_in_the_catalog_is_unknown(client):
    body = client.post(
        "/api/vision/scan",
        json={"weightDelta": 450, "detection": {"sku": "NOPE-1", "confidence": 0.9}},
    ).json()
    assert (body["accepted"], body["reason"]) == (False, "unknown item")


def test_no_input_is_a_400(client):
    assert client.post("/api/vision/scan", json={"weightDelta": 450}).status_code == 400


def test_product_core_down_is_a_503_never_accepted(client, monkeypatch):
    async def down(_sku):
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(main, "fetch_catalog_weight", down)
    response = client.post(
        "/api/vision/scan",
        json={"weightDelta": 450, "detection": {"sku": "PNT-001", "confidence": 0.9}},
    )
    assert response.status_code == 503


def test_health_reports_whether_a_model_is_loaded(client):
    assert client.get("/api/health").json()["modelLoaded"] is False


def test_decode_refuses_junk():
    with pytest.raises(FrameError):
        decode_frame("%%%")


def test_preprocess_gives_the_shape_and_range_the_model_expects():
    tensor = preprocess(Image.new("RGB", (1280, 720), (255, 255, 255)))
    assert tensor.shape == (1, 3, 640, 640)
    assert tensor.dtype == np.float32
    assert tensor.min() >= 0 and tensor.max() == pytest.approx(1.0)


def test_roi_crops_by_fraction():
    assert crop_roi(Image.new("RGB", (100, 200)), (0.25, 0.5, 0.75, 1.0)).size == (50, 100)


def test_scores_keep_the_best_candidate_per_class_above_the_floor():
    raw = np.zeros((1, 84, 3), dtype=np.float32)
    raw[0, 4 + 46, :] = [0.2, 0.9, 0.5]  # banana
    raw[0, 4 + 47, :] = [0.1, 0.2, 0.1]  # apple, below the floor
    assert best_score_per_class(raw) == {"banana": pytest.approx(0.9)}


MODEL = os.environ.get("MODEL_PATH", "models/yolov8n.onnx")
PHOTO = os.environ.get("TEST_PHOTO", "")


@pytest.mark.skipif(not (os.path.exists(MODEL) and os.path.exists(PHOTO)), reason="needs the exported model and TEST_PHOTO")
def test_real_model_on_a_real_photo():
    scores = OnnxDetector(MODEL).detect(Image.open(PHOTO).convert("RGB"))
    assert max(scores, key=lambda c: scores[c]) == "banana"


def test_confidence_reaches_the_metrics(client):
    client.post("/api/vision/scan", json={"weightDelta": 450, "detection": {"sku": "PNT-001", "confidence": 0.85}})
    body = client.get("/metrics").text
    assert 'ase_vision_confidence_count{source="simulated"}' in body
    assert 'ase_vision_scans_total{accepted="true",source="simulated"}' in body
