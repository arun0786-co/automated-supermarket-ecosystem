// esp32 firmware for the trolley's load cells (chapter 2.1.2). the four cells share one hx711 in a
// wheatstone bridge. settled weight changes go to the jetson as one json line each over serial,
// and the jetson turns them into mqtt scans.
//
// this compiles but has never run on a device. CALIBRATION_FACTOR in particular is a placeholder
// that has to be measured on real hardware with a known weight
#include <Arduino.h>
#include <HX711.h>

#include "stabilizer.h"

namespace {

constexpr int kDataPin = 16;
constexpr int kClockPin = 4;
constexpr float kCalibrationFactor = 420.0f;
constexpr int kTareSamples = 20;
constexpr uint32_t kHeartbeatMs = 5000;

HX711 scale;
ase::WeightStabilizer stabilizer;
uint32_t last_heartbeat = 0;

}  // namespace

void setup() {
  Serial.begin(115200);
  scale.begin(kDataPin, kClockPin);
  scale.set_scale(kCalibrationFactor);
  // the empty trolley reads as zero
  scale.tare(kTareSamples);
  Serial.println("{\"event\":\"ready\"}");
}

void loop() {
  const uint32_t now = millis();

  // so the jetson can tell a quiet trolley from a dead load cell
  if (now - last_heartbeat >= kHeartbeatMs) {
    last_heartbeat = now;
    Serial.printf("{\"event\":\"heartbeat\",\"ok\":%s}\n", scale.is_ready() ? "true" : "false");
  }

  // the hx711 has a sample about every 100ms. waiting for it here would block the heartbeat
  if (!scale.is_ready()) {
    delay(5);
    return;
  }

  if (stabilizer.update(scale.get_units(), now)) {
    Serial.printf("{\"event\":\"weight\",\"weightDelta\":%.1f,\"total\":%.1f,\"ts\":%lu}\n", stabilizer.delta(),
                  stabilizer.baseline(), static_cast<unsigned long>(now));
  }
}
