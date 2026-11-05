"""trains yolov8 nano on store product images (chapter 5.2 and 5.3 of the spec), then exports what
the vision service needs: an onnx model, and labels.json mapping each class to its sku.

  python train.py --data store.yaml --epochs 100

the class names in the dataset have to be the skus, see dataset.example.yaml. copy the two output
files to stage-b-mvp/services/vision/models and that service uses them with no code change
"""
import argparse
import json
import shutil
from pathlib import Path

from ultralytics import YOLO


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", required=True, help="dataset yaml")
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--device", default=None, help="cpu, or a gpu number. picked automatically if left out")
    parser.add_argument("--out", default="output", help="where the model and labels end up")
    args = parser.parse_args()

    model = YOLO("yolov8n.pt")
    model.train(data=args.data, epochs=args.epochs, imgsz=args.imgsz, device=args.device, name="store", exist_ok=True)

    # the trainer knows where it saved them, and that location varies between versions
    best = YOLO(str(model.trainer.best))
    exported = best.export(format="onnx", imgsz=args.imgsz, opset=17, simplify=True)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    shutil.copy(exported, out / "model.onnx")
    labels = [best.names[i] for i in sorted(best.names)]
    (out / "labels.json").write_text(json.dumps(labels))
    print(f"wrote {out / 'model.onnx'} and {out / 'labels.json'} with {len(labels)} classes")


if __name__ == "__main__":
    main()
