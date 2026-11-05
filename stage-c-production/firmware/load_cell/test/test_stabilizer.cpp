// host tests for the trigger logic: c++ -std=c++17 -Isrc test/test_stabilizer.cpp && ./a.out
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <initializer_list>
#include <limits>

#include "stabilizer.h"

using ase::WeightStabilizer;

static int failures = 0;
#define CHECK(condition)                                         \
  do {                                                           \
    if (!(condition)) {                                          \
      printf("FAIL  %s line %d: %s\n", __func__, __LINE__, #condition); \
      failures++;                                                \
    }                                                            \
  } while (0)

// a reading every 80ms, about what an hx711 gives at its default 10 samples a second
static constexpr uint32_t kStep = 80;

// feeds a constant weight for a while. returns how many events fired, and keeps the clock going
static int hold(WeightStabilizer& s, float grams, uint32_t ms, uint32_t& now) {
  int events = 0;
  for (uint32_t step = 0; step < ms / kStep; step++, now += kStep) {
    if (s.update(grams, now)) events++;
  }
  return events;
}

static void settled(WeightStabilizer& s, float grams, uint32_t& now) { hold(s, grams, 1000, now); }

static void test_the_first_settled_weight_is_not_an_item() {
  WeightStabilizer s;
  uint32_t now = 0;
  CHECK(hold(s, 2000, 2000, now) == 0);
  CHECK(std::fabs(s.baseline() - 2000) < 0.1);
}

static void test_an_item_fires_once_with_its_weight() {
  WeightStabilizer s;
  uint32_t now = 0;
  settled(s, 2000, now);
  CHECK(hold(s, 2450, 3000, now) == 1);
  CHECK(std::fabs(s.delta() - 450) < 0.1);
}

// chapter 5.3: dWeight > 10g
static void test_changes_of_10g_or_less_are_ignored() {
  WeightStabilizer s;
  uint32_t now = 0;
  settled(s, 2000, now);
  CHECK(hold(s, 2009, 2000, now) == 0);
}

static void test_just_over_10g_fires() {
  WeightStabilizer s;
  uint32_t now = 0;
  settled(s, 2000, now);
  // outside the stable band, so it starts a new window
  CHECK(hold(s, 2011, 2000, now) == 1);
}

// chapter 2.1.2: readings are only good to +/- 5g
static void test_load_cell_noise_is_not_an_item() {
  WeightStabilizer s;
  uint32_t now = 0;
  int events = 0;
  for (int i = 0; i < 200; i++, now += kStep) {
    const float noise = (i % 2 == 0) ? 2.0f : -2.0f;
    if (s.update(2000 + noise, now)) events++;
  }
  CHECK(events == 0);
}

// the worst the spec allows: consecutive readings at opposite ends of +/- 5g
static void test_noise_at_the_spec_limit_still_settles() {
  WeightStabilizer s;
  uint32_t now = 0;
  settled(s, 2000, now);
  int events = 0;
  for (int i = 0; i < 50; i++, now += kStep) {
    if (s.update(2450 + ((i % 2 == 0) ? 5.0f : -5.0f), now)) events++;
  }
  CHECK(events == 1);
  CHECK(std::fabs(s.delta() - 450) < 2);
}

static void test_it_waits_for_the_bouncing_to_stop() {
  WeightStabilizer s;
  uint32_t now = 0;
  settled(s, 2000, now);
  // the item lands and the basket bounces
  int during = 0;
  for (float bounce : {2600.f, 2300.f, 2550.f, 2380.f, 2500.f, 2420.f}) {
    if (s.update(bounce, now)) during++;
    now += kStep;
  }
  CHECK(during == 0);
  CHECK(hold(s, 2450, 1000, now) == 1);
  CHECK(std::fabs(s.delta() - 450) < 0.1);
}

static void test_a_reading_shorter_than_the_window_does_not_fire() {
  WeightStabilizer s;
  uint32_t now = 0;
  settled(s, 2000, now);
  // someone leans on the trolley for a moment
  CHECK(hold(s, 2800, 400, now) == 0);
  CHECK(hold(s, 2000, 1000, now) == 0);
}

static void test_an_item_removed_is_a_negative_delta() {
  WeightStabilizer s;
  uint32_t now = 0;
  settled(s, 2000, now);
  hold(s, 2450, 1000, now);
  CHECK(hold(s, 2000, 1000, now) == 1);
  CHECK(std::fabs(s.delta() + 450) < 0.1);
}

static void test_items_in_a_row_each_fire() {
  WeightStabilizer s;
  uint32_t now = 0;
  settled(s, 2000, now);
  CHECK(hold(s, 2150, 1000, now) == 1);
  CHECK(std::fabs(s.delta() - 150) < 0.1);
  CHECK(hold(s, 2300, 1000, now) == 1);
  CHECK(std::fabs(s.delta() - 150) < 0.1);
}

static void test_noise_during_the_window_averages_out() {
  WeightStabilizer s;
  uint32_t now = 0;
  settled(s, 2000, now);
  bool fired = false;
  for (int i = 0; i < 25 && !fired; i++, now += kStep) {
    fired = s.update(2450 + ((i % 2 == 0) ? 3.0f : -3.0f), now);
  }
  CHECK(fired);
  CHECK(std::fabs(s.delta() - 450) < 2);
}

static void test_a_bad_read_from_the_adc_is_ignored() {
  WeightStabilizer s;
  uint32_t now = 0;
  settled(s, 2000, now);
  CHECK(!s.update(std::numeric_limits<float>::quiet_NaN(), now));
  CHECK(!s.update(std::numeric_limits<float>::infinity(), now + kStep));
  now += 2 * kStep;
  CHECK(hold(s, 2000, 1000, now) == 0);
  CHECK(hold(s, 2450, 1000, now) == 1);
}

// millis() overflows after 49 days, and a trolley can run that long on its charger
static void test_the_clock_wrapping_around_changes_nothing() {
  WeightStabilizer s;
  uint32_t now = UINT32_MAX - 1200;
  settled(s, 2000, now);
  CHECK(hold(s, 2450, 1000, now) == 1);
  CHECK(now < 2000);  // the test really did cross zero
  CHECK(std::fabs(s.delta() - 450) < 0.1);
}

int main() {
  test_the_first_settled_weight_is_not_an_item();
  test_an_item_fires_once_with_its_weight();
  test_changes_of_10g_or_less_are_ignored();
  test_just_over_10g_fires();
  test_load_cell_noise_is_not_an_item();
  test_noise_at_the_spec_limit_still_settles();
  test_it_waits_for_the_bouncing_to_stop();
  test_a_reading_shorter_than_the_window_does_not_fire();
  test_an_item_removed_is_a_negative_delta();
  test_items_in_a_row_each_fire();
  test_noise_during_the_window_averages_out();
  test_a_bad_read_from_the_adc_is_ignored();
  test_the_clock_wrapping_around_changes_nothing();
  if (failures == 0) printf("all stabilizer tests passed\n");
  return failures == 0 ? 0 : 1;
}
