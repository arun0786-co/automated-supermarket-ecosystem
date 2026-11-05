import math

import pytest

from fusion import MIN_CONFIDENCE, aggregate_burst, fuse


# the worked example from chapter 5.4 of the spec
def test_spec_cereal_example_is_added_to_cart():
    result = fuse(confidence=0.85, weight_delta=450, catalog_weight=450)
    assert result.accepted
    assert result.reason is None
    assert result.probability > 0.99


# the conflict example from chapter 5.4: camera says cereal, scale says brick
def test_spec_brick_example_is_rejected():
    result = fuse(confidence=0.85, weight_delta=1000, catalog_weight=450)
    assert not result.accepted
    assert result.reason == "weight mismatch"
    assert result.probability < 0.01


def test_below_minimum_confidence_is_rejected_even_at_the_right_weight():
    result = fuse(confidence=0.59, weight_delta=450, catalog_weight=450)
    assert not result.accepted
    assert result.reason == "low confidence"


def test_minimum_confidence_itself_is_accepted():
    assert fuse(confidence=MIN_CONFIDENCE, weight_delta=450, catalog_weight=450).accepted


# chapter 5.4: standard weight is 450g +/- 10g
@pytest.mark.parametrize("delta,accepted", [(460, True), (440, True), (460.1, False), (439.9, False)])
def test_weight_tolerance_edges(delta, accepted):
    assert fuse(confidence=0.9, weight_delta=delta, catalog_weight=450).accepted is accepted


def test_probability_falls_as_the_weight_drifts():
    exact = fuse(confidence=0.7, weight_delta=450, catalog_weight=450).probability
    drifted = fuse(confidence=0.7, weight_delta=458, catalog_weight=450).probability
    assert 0 < drifted < exact < 1


# an item taken out of the trolley shows up as a negative delta, never as an add
def test_item_removed_is_not_added():
    assert not fuse(confidence=0.9, weight_delta=-450, catalog_weight=450).accepted


@pytest.mark.parametrize("confidence", [math.nan, -0.1, 1.1])
def test_impossible_confidence_is_rejected(confidence):
    result = fuse(confidence=confidence, weight_delta=450, catalog_weight=450)
    assert not result.accepted
    assert result.reason == "low confidence"
    assert result.probability == 0


def test_impossible_weight_is_rejected():
    for delta in (math.nan, math.inf):
        result = fuse(confidence=0.9, weight_delta=delta, catalog_weight=450)
        assert not result.accepted
        assert result.reason == "weight mismatch"


def test_burst_majority_wins_with_the_mean_of_its_frames():
    frames = [{"banana": 0.9}, {"banana": 0.8}, {"apple": 0.99}, {"banana": 0.7}, {}]
    assert aggregate_burst(frames) == ("banana", pytest.approx(0.8))


def test_burst_uses_the_strongest_class_in_each_frame():
    frames = [{"banana": 0.9, "apple": 0.3}, {"apple": 0.4, "banana": 0.6}]
    assert aggregate_burst(frames) == ("banana", pytest.approx(0.75))


def test_burst_tie_goes_to_the_higher_confidence():
    frames = [{"banana": 0.6}, {"apple": 0.9}]
    assert aggregate_burst(frames) == ("apple", pytest.approx(0.9))


def test_burst_with_nothing_detected():
    assert aggregate_burst([{}, {}, {}]) is None
    assert aggregate_burst([]) is None
