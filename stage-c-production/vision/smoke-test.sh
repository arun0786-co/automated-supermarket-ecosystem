#!/usr/bin/env bash
# proves the pipeline runs and its output fits the vision service: one epoch on the small public
# coco8 sample, on cpu, in a throwaway container. the resulting model is useless and that's fine,
# it says nothing about accuracy on store products. usage: smoke-test.sh <folder for the output>
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
VISION="$HERE/../../stage-b-mvp/services/vision"
OUT=${1:?folder for the output}
mkdir -p "$OUT"
docker run --rm -v ase-pip-cache:/root/.cache/pip -v "$HERE:/pipeline:ro" -v "$VISION:/vision:ro" -v "$OUT:/out" python:3.11-slim bash -c '
  set -e
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends libgl1 libglib2.0-0 > /dev/null
  PIP="pip install -q --root-user-action=ignore --disable-pip-version-check"
  $PIP --index-url https://download.pytorch.org/whl/cpu torch torchvision
  $PIP -r /pipeline/requirements.txt
  mkdir -p /tmp/run && cd /tmp/run
  python /pipeline/train.py --data coco8.yaml --epochs 1 --imgsz 160 --device cpu --out /out > train.log 2>&1 || { tail -30 train.log; exit 1; }
  tail -1 train.log

  $PIP -r /vision/requirements.txt
  cd /vision
  python -B - <<PY
import json, numpy as np
from PIL import Image
from detector import OnnxDetector, load_labels
labels = load_labels("/out/labels.json")
assert len(labels) == 80, len(labels)
detector = OnnxDetector("/out/model.onnx", labels)
scores = detector.detect(Image.fromarray(np.zeros((480, 640, 3), dtype=np.uint8)))
assert all(name in labels for name in scores), scores
print("ok    the vision service loads the trained model and its labels:", len(labels), "classes")
PY
'
