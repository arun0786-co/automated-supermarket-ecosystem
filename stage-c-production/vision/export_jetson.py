"""exports a trained model to tensorrt for the jetson (chapter 5.2), int8 quantized.

this has to run on a jetson or a machine with an nvidia gpu, and has never been run here. int8
calibration needs images from the same dataset the model trained on.

  python export_jetson.py --weights <path to best.pt from training> --data store.yaml
"""
import argparse

from ultralytics import YOLO


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--weights", required=True)
    parser.add_argument("--data", required=True, help="dataset yaml, used to calibrate int8")
    parser.add_argument("--imgsz", type=int, default=640)
    args = parser.parse_args()
    print(YOLO(args.weights).export(format="engine", int8=True, data=args.data, imgsz=args.imgsz))


if __name__ == "__main__":
    main()
