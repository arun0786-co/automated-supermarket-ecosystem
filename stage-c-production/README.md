# Stage C: Production

Everything that can be built and tested without a physical trolley or a paid cloud account. [docs/roadmap.md](../docs/roadmap.md) has what has been proven and what hasn't.

| Folder | What it is | How it was tested | Not proven |
|---|---|---|---|
| `k8s/` | Kustomize manifests for every service | Deployed to a real local cluster, API checks plus network policies, non-root and pod recovery | A cloud account, ArgoCD, Istio |
| `robotics/` | Layered costmap, A\*, D\* Lite and a ROS 2 node | Unit tests, property tests against A\*, and the node over real topics in ROS 2 Humble | Gazebo, SLAM, a real trolley |
| `firmware/` | ESP32 load cell firmware | Logic tested on a computer, compiled for an ESP32 | Running on any device. Calibration is a placeholder |
| `vision/` | YOLOv8 training and export | One epoch on the coco8 sample, result loaded by the vision service | Accuracy: no store dataset exists. TensorRT needs a Jetson |

## Kubernetes

```bash
make k8s-test     # needs docker, kind and kubectl. creates a cluster, tests it, removes it
```

If `mqtt-broker` crash-loops with `Unable to open config file`, the host has an AppArmor profile for mosquitto, which Ubuntu 26.04 on GitHub's runners does. It attaches to the broker inside kind by its path. Unload it first with `sudo apparmor_parser -R /etc/apparmor.d/mosquitto`. CI does this.

To deploy somewhere real:

```bash
cd stage-c-production/k8s
bash scripts/create-secrets.sh        # random passwords, nothing committed
bash scripts/create-besu-secret.sh    # validator keys. set CHAIN_MNEMONIC and change the genesis first
kubectl apply -k overlays/production
```

| Overlay | Images | Chain | Trolleys |
|---|---|---|---|
| `local` | Built locally | Hardhat | Simulated |
| `local-besu` | Built locally | Besu | Simulated |
| `production` | Released, from GHCR | Besu | Real, through the broker's public address |

Before going live, this needs a certificate on the gateway's load balancer, real Postgres and Redis backups or managed versions (chapter 11.3), and migrations instead of `synchronize: true` in product-core. `fintech-vault`, `fleet-engine` and `ai-engine` are one replica on purpose, and their manifests say why.

`k8s/base/config` is generated from `stage-b-mvp/config` by `scripts/sync-config.sh`, so edit the originals. The test fails if they drift.

**CD (chapter 11.1).** Pushing a `v*` tag publishes images through `.github/workflows/images.yml`. Changing the tags in `overlays/production` and committing makes ArgoCD deploy them, once `argocd/application.yaml` is applied to a cluster running ArgoCD. Neither has been run yet.

**Mutual TLS (chapter 3.1.2).** Add `components/istio-mtls` to an overlay in a cluster with Istio.

## Navigation

```bash
cd robotics/ase_navigation && python -m pytest test
bash robotics/test-in-ros.sh    # builds and runs the node in ros 2 humble, needs only docker
```

Chapter 8.4 says A\* for an empty store and D\* during opening hours. Measured, in expansions to replan after one obstacle appears:

| Map | Obstacle | D\* Lite | Fresh A\* |
|---|---|---|---|
| Store floor | 5 cells ahead | 12 | 1482 |
| Store floor | Near the goal | 281 | 1384 |
| 120x120, 20% cluttered | 5 cells ahead | 131 | 4305 |
| 120x120, empty | 5 cells ahead | 434 | 274 |

D\* Lite searches back from the goal, so it's cheapest when the change is near the robot, which is where a LiDAR sees things. On an empty floor A\* wins. So the spec's split holds up.

The node takes `map`, `pose`, `goal_pose` and `scan`, and publishes `plan`. A SLAM node has to provide `map` and `pose` on a real trolley.

## Firmware

```bash
cd firmware/load_cell
c++ -std=c++17 -Isrc test/test_stabilizer.cpp -o /tmp/stabilizer-test && /tmp/stabilizer-test
bash build-for-esp32.sh    # compiles it in a container
```

It sends one JSON line over serial per settled weight change. Something on the Jetson has to turn those lines into MQTT scans, and that bridge isn't written, because it needs the real serial port and camera to test against.

## Training

```bash
cd vision
cp dataset.example.yaml store.yaml    # point it at your photos, class names are skus
python train.py --data store.yaml
cp output/model.onnx ../../stage-b-mvp/services/vision/models/yolov8n.onnx
cp output/labels.json ../../stage-b-mvp/services/vision/models/labels.json
```

The vision service picks up `labels.json` and uses it with no code change. `smoke-test.sh` proves the pipeline runs, and says nothing about accuracy.

## Hardware, when you get there

| Component | Spec | Estimate |
|---|---|---|
| Trolley compute | NVIDIA Jetson Orin Nano 8GB | ~$499 |
| Internal cameras | 2× Arducam 8MP wide-angle | ~$60 |
| Depth camera | Intel RealSense D435 | ~$179 |
| Weight sensors | 4× 50kg load cells + HX711 ADC | ~$25 |
| LiDAR | RPLIDAR A1 (360° 2D) | ~$99 |
| Motor controller | ODrive v3.6 | ~$149 |
| Battery | LiFePO4 24V 20Ah pack | ~$180 |

**Minimum viable trolley: about $1,200 a unit.**

Replacing the simulator is meant to be simple: a real trolley only has to publish the topics in [docs/api-stage-b.md](../docs/api-stage-b.md), with `frames` instead of `detection`.
