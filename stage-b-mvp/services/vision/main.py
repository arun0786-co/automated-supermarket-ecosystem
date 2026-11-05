"""service B: decides whether what the trolley saw and weighed goes into the cart."""
import logging
import os
from contextlib import asynccontextmanager
from typing import Annotated, Literal, Optional

import httpx
from fastapi import FastAPI, HTTPException, Response
from fastapi.concurrency import run_in_threadpool
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest
from pydantic import BaseModel, Field, StringConstraints

from detector import FrameError, OnnxDetector, crop_roi, decode_frame, load_labels, sku_for
from fusion import aggregate_burst, fuse

log = logging.getLogger("vision")

PRODUCT_CORE_URL = os.environ.get("PRODUCT_CORE_URL", "http://product-core:3001")
MODEL_PATH = os.environ.get("MODEL_PATH", "/models/yolov8n.onnx")
# only for a model trained on store images: its class names, which are skus
LABELS_PATH = os.environ.get("LABELS_PATH", "/models/labels.json")
# region of the camera view that covers the basket, as fractions of the frame
ROI = tuple(float(v) for v in os.environ.get("VISION_ROI", "0,0,1,1").split(","))

# chapter 11.2: "Vision Model Confidence"
CONFIDENCE = Histogram(
    "ase_vision_confidence",
    "Confidence of the detection behind each scan",
    ["source"],
    buckets=[0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 1.0],
)
RESULTS = Counter("ase_vision_scans_total", "Fusion decisions", ["source", "accepted"])

# chapter 5.3: the camera grabs a burst of 5 frames
MAX_FRAMES = 5
MAX_FRAME_BASE64 = 4_000_000


@asynccontextmanager
async def lifespan(app: FastAPI):
    # the service still runs without weights so simulated trolleys can use the fusion step.
    # real frames get a 503 instead of a made up answer
    labels = load_labels(LABELS_PATH) if os.path.exists(LABELS_PATH) else None
    app.state.detector = OnnxDetector(MODEL_PATH, labels) if os.path.exists(MODEL_PATH) else None
    log.warning("vision model %s", "loaded" if app.state.detector else f"not found at {MODEL_PATH}")
    yield


app = FastAPI(title="ASE-PRIME Vision", version="1.0.0", lifespan=lifespan)
app.state.detector = None


class Detection(BaseModel):
    sku: str
    confidence: float


class ScanRequest(BaseModel):
    weightDelta: float
    frames: Optional[list[Annotated[str, StringConstraints(max_length=MAX_FRAME_BASE64)]]] = Field(
        None, min_length=1, max_length=MAX_FRAMES
    )
    # stands in for the camera on simulated trolleys, always reported as simulated
    detection: Optional[Detection] = None


class ScanResponse(BaseModel):
    sku: Optional[str]
    confidence: float
    fusionProbability: float
    accepted: bool
    reason: Optional[str] = None
    source: Literal["model", "simulated"]


async def fetch_catalog_weight(sku: str) -> Optional[float]:
    """standard weight from service A. None if the sku isn't in the catalog"""
    async with httpx.AsyncClient(timeout=3.0) as client:
        response = await client.get(f"{PRODUCT_CORE_URL}/api/products/{sku}")
    if response.status_code == 404:
        return None
    response.raise_for_status()
    return float(response.json()["weight"])


def rejected(sku: Optional[str], confidence: float, reason: str, source: str) -> ScanResponse:
    return ScanResponse(sku=sku, confidence=confidence, fusionProbability=0.0, accepted=False, reason=reason, source=source)


def run_burst(frames: list[str]) -> Optional[tuple[str, float]]:
    detector = app.state.detector
    images = [crop_roi(decode_frame(frame), ROI) for frame in frames]
    return aggregate_burst([detector.detect(image) for image in images])


# scraped by prometheus. the gateway only routes /api/vision here
@app.get("/metrics")
def metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "vision", "stage": "B", "modelLoaded": app.state.detector is not None}


@app.post("/api/vision/scan", response_model=ScanResponse, response_model_exclude_none=False)
async def scan(req: ScanRequest) -> ScanResponse:
    if req.frames:
        if app.state.detector is None:
            raise HTTPException(503, "no vision model loaded")
        source = "model"
        try:
            burst = await run_in_threadpool(run_burst, req.frames)
        except FrameError as err:
            raise HTTPException(400, "a frame could not be decoded") from err
        if burst is None:
            return rejected(None, 0.0, "no detection", source)
        name, confidence = burst
        sku = sku_for(name, getattr(app.state.detector, "trained_on_store", False))
        if sku is None:
            return rejected(None, confidence, "unknown item", source)
    elif req.detection:
        source = "simulated"
        sku, confidence = req.detection.sku, req.detection.confidence
    else:
        raise HTTPException(400, "send frames or a detection")

    try:
        weight = await fetch_catalog_weight(sku)
    except (httpx.HTTPError, KeyError, ValueError) as err:
        # without the catalog nothing can be verified, so nothing gets accepted
        log.warning("catalog lookup failed for %s: %s", sku, err)
        raise HTTPException(503, "product catalog unavailable") from err
    if weight is None:
        return rejected(sku, confidence, "unknown item", source)

    result = fuse(confidence, req.weightDelta, weight)
    CONFIDENCE.labels(source).observe(confidence)
    RESULTS.labels(source, str(result.accepted).lower()).inc()
    return ScanResponse(
        sku=sku,
        confidence=confidence,
        fusionProbability=round(result.probability, 4),
        accepted=result.accepted,
        reason=result.reason,
        source=source,
    )
