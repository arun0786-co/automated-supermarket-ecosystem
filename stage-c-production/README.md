# Stage C: Production Hardware Integration

This directory will contain everything that actually runs on the physical smart trolleys,
the edge gateway servers, and the cloud Kubernetes cluster. Stage B must be complete
and stable before any code lands here.

## Hardware Required

| Component | Spec | Cost (est.) |
|---|---|---|
| Trolley compute | NVIDIA Jetson Orin Nano 8GB | ~$499 |
| Internal cameras | 2× Arducam 8MP wide-angle | ~$60 |
| Depth camera | Intel RealSense D435 | ~$179 |
| Weight sensors | 4× 50kg load cells + HX711 ADC | ~$25 |
| LiDAR | RPLIDAR A1 (360° 2D) | ~$99 |
| Motor controller | ODrive v3.6 | ~$149 |
| Battery | LiFePO4 24V 20Ah pack | ~$180 |

**Minimum viable trolley cost: ~$1,200 (single unit)**

## Software Stack

### On the Jetson Orin Nano (Edge)
- **OS:** JetPack 6.x (Ubuntu 22.04 + CUDA)
- **Container:** Docker (NVIDIA runtime)
- **Robotics:** ROS 2 Humble Hawksbill
- **Vision:** YOLOv8-nano (TensorRT-optimized, INT8 quantized)
- **Video Pipeline:** NVIDIA DeepStream SDK
- **Weight Controller:** Custom ESP32 firmware (C++ / Arduino)

### On Edge Gateway (Store Rack)
- **OS:** Ubuntu Server 22.04
- **Container Orchestration:** K3s (lightweight Kubernetes)
- **Message Broker:** MQTT Mosquitto
- **Services:** Service A (Product Core) + Service B (Vision fallback)

### On Cloud (AWS / GCP)
- **Cluster:** EKS or GKE
- **Services:** Service C (Blockchain), Service D (AI), Service F (Mobile backend)
- **Monitoring:** Prometheus + Grafana
- **Tracing:** Jaeger

## Roadmap

- [ ] ESP32 firmware for load cell ADC
- [ ] YOLOv8 training pipeline (50k SKU dataset)
- [ ] ROS 2 SLAM node for trolley localisation
- [ ] D* pathfinding for dynamic obstacle avoidance
- [ ] Hardhat → Hyperledger Besu migration
- [ ] Kubernetes manifests for all services
- [ ] CI/CD pipeline (GitHub Actions → ArgoCD)

## How to Get Here from Stage B

1. Train YOLOv8 model on your store's product images
2. Export to TensorRT (`.engine` file for Jetson)
3. Flash the ESP32 firmware
4. Deploy ROS 2 nodes via Docker to Jetson
5. Point Stage B services at real MQTT broker instead of simulator
