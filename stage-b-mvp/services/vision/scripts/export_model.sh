#!/usr/bin/env bash
# exports the official pretrained yolov8n weights to models/yolov8n.onnx, inside a throwaway
# container, so torch never gets installed on the host or in the service image.
# the model is not committed. ultralytics and its weights are AGPL-3.0, see the stage B readme.
set -eu

cd "$(dirname "$0")/.."
mkdir -p models
docker run --rm -v ase-pip-cache:/root/.cache/pip -v "$PWD/models:/out" python:3.11-slim sh -c '
  set -e
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends libgl1 libglib2.0-0 > /dev/null
  PIP="pip install -q --root-user-action=ignore --disable-pip-version-check"
  $PIP --index-url https://download.pytorch.org/whl/cpu torch torchvision
  $PIP ultralytics==8.4.* onnx onnxslim
  cd /tmp
  yolo export model=yolov8n.pt format=onnx imgsz=640 opset=17 simplify=True
  cp yolov8n.onnx /out/yolov8n.onnx
  pip list --format=freeze --disable-pip-version-check | grep -E "^(ultralytics|torch)=="
'
ls -la models/yolov8n.onnx
