"""frame decoding and yolov8 onnx inference (chapter 5.3 of the spec)."""
import base64
import binascii
import io
import json
from typing import Optional, Sequence

import numpy as np
import onnxruntime as ort
from PIL import Image

# stops a hostile frame from decompressing into gigabytes. the trolley cameras are 8MP
Image.MAX_IMAGE_PIXELS = 50_000_000

INPUT_SIZE = 640
MIN_SCORE = 0.25

# class order of the official pretrained yolov8 weights
COCO_CLASSES = (
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat",
    "traffic light", "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog",
    "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella",
    "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball", "kite",
    "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket", "bottle",
    "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange",
    "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch", "potted plant",
    "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard", "cell phone",
    "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase", "scissors",
    "teddy bear", "hair drier", "toothbrush",
)

# the only catalog items the pretrained model can recognise. a model trained on store images
# (stage-c-production/vision) names its classes by sku and comes with labels.json instead
COCO_TO_SKU = {
    "banana": "PRD-001",
    "apple": "PRD-002",
    "orange": "PRD-003",
    "broccoli": "PRD-006",
    "carrot": "PRD-007",
}


class FrameError(ValueError):
    """a frame that can't be decoded into an image"""


def decode_frame(encoded: str) -> Image.Image:
    try:
        image = Image.open(io.BytesIO(base64.b64decode(encoded, validate=True)))
        return image.convert("RGB")
    except (binascii.Error, ValueError, OSError, Image.DecompressionBombError) as err:
        raise FrameError(str(err)) from err


def crop_roi(image: Image.Image, roi: tuple[float, float, float, float]) -> Image.Image:
    """roi is left, top, right, bottom as fractions of the frame"""
    left, top, right, bottom = roi
    width, height = image.size
    return image.crop((int(left * width), int(top * height), int(right * width), int(bottom * height)))


def preprocess(image: Image.Image, size: int = INPUT_SIZE) -> np.ndarray:
    """letterbox to the model size, normalise to 0-1 and reorder to NCHW"""
    scale = size / max(image.size)
    resized = image.resize(
        (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
        Image.Resampling.BILINEAR,
    )
    canvas = Image.new("RGB", (size, size), (114, 114, 114))
    canvas.paste(resized, ((size - resized.width) // 2, (size - resized.height) // 2))
    return (np.asarray(canvas, dtype=np.float32) / 255.0).transpose(2, 0, 1)[np.newaxis]


def model_input_size(shape: Sequence) -> int:
    """the square size a model was exported at. some exports leave it open, shown as a name"""
    height = shape[2] if len(shape) == 4 else None
    return height if isinstance(height, int) else INPUT_SIZE


def load_labels(path: str) -> list[str]:
    """the class names of a store-trained model, in class order"""
    with open(path) as handle:
        labels = json.load(handle)
    if not isinstance(labels, list) or not labels or not all(isinstance(label, str) for label in labels):
        raise ValueError(f"{path} should be a list of class names")
    return labels


def best_score_per_class(raw: np.ndarray, labels: Sequence[str] = COCO_CLASSES) -> dict[str, float]:
    """yolov8 output is (1, 4 box values + classes, candidates). boxes aren't needed: fusion
    only asks what is in the frame, so the highest score per class is enough"""
    scores = raw[0][4:].max(axis=1)
    return {labels[i]: float(s) for i, s in enumerate(scores) if s >= MIN_SCORE}


def sku_for(name: str, trained_on_store: bool) -> Optional[str]:
    """a store model already names its classes by sku. the pretrained one goes through the map"""
    return name if trained_on_store else COCO_TO_SKU.get(name)


class OnnxDetector:
    def __init__(self, path: str, labels: Optional[Sequence[str]] = None):
        self.session = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
        self.input_name = self.session.get_inputs()[0].name
        self.input_size = model_input_size(self.session.get_inputs()[0].shape)
        self.labels = labels
        self.trained_on_store = labels is not None

    def detect(self, image: Image.Image) -> dict[str, float]:
        return best_score_per_class(self.session.run(None, {self.input_name: preprocess(image, self.input_size)})[0], self.labels or COCO_CLASSES)
