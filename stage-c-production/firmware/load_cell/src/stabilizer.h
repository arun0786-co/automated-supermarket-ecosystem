// the load cell trigger from chapter 5.3 of the spec: an event fires when the weight settles at a
// new value more than 10g from the last settled one. no arduino code in here, so it runs in the
// host tests too
#pragma once

#include <cmath>
#include <cstdint>

namespace ase {

// the cells are good to +/- 5g (chapter 2.1.2), so two readings of the same weight can be 10g apart
constexpr float kStableBandG = 10.0f;
// how long a reading has to hold before it counts. long enough for a dropped item to stop bouncing
constexpr uint32_t kStableForMs = 500;
// chapter 5.3: dWeight > 10g
constexpr float kMinDeltaG = 10.0f;

class WeightStabilizer {
 public:
  // feed every reading. true means a change settled, and delta() has its size in grams:
  // positive for an item added, negative for one taken out
  bool update(float grams, uint32_t now_ms) {
    if (!std::isfinite(grams)) return false;  // a bad read from the adc tells us nothing

    // compared with the running average: against any single reading, ordinary noise would keep
    // restarting the window and it would never settle
    if (count_ == 0 || std::fabs(grams - sum_ / static_cast<float>(count_)) > kStableBandG) {
      candidate_since_ = now_ms;
      fired_for_candidate_ = false;
      sum_ = grams;
      count_ = 1;
      return false;
    }

    sum_ += grams;
    count_++;
    // subtraction stays correct when millis() wraps around after 49 days
    if (fired_for_candidate_ || now_ms - candidate_since_ < kStableForMs) return false;

    // the average of the window is steadier than any one reading
    const float settled = sum_ / static_cast<float>(count_);
    fired_for_candidate_ = true;
    if (!has_baseline_) {
      has_baseline_ = true;
      baseline_ = settled;
      return false;  // the first settled weight is just the empty trolley
    }
    const float change = settled - baseline_;
    if (std::fabs(change) <= kMinDeltaG) return false;
    baseline_ = settled;
    delta_ = change;
    return true;
  }

  float delta() const { return delta_; }
  float baseline() const { return baseline_; }

 private:
  bool has_baseline_ = false;
  bool fired_for_candidate_ = false;
  uint32_t candidate_since_ = 0;
  float sum_ = 0;
  uint32_t count_ = 0;
  float baseline_ = 0;
  float delta_ = 0;
};

}  // namespace ase
