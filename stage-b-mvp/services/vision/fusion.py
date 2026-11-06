"""vision + weight fusion from chapter 5.4 of the spec (service B)."""
import math
from collections import defaultdict
from dataclasses import dataclass
from typing import Optional

# same gate as the stage A simulator
MIN_CONFIDENCE = 0.60
# chapter 5.4: the load cell has to read the catalog weight within +/- 10g
WEIGHT_TOLERANCE_G = 10.0
# chapter 2.1.2: the load cells are precise to +/- 5g
LOAD_CELL_SIGMA_G = 5.0
# if the camera is wrong the reading says nothing about this item, so treat it as
# any weight in the range a trolley sees
WEIGHT_RANGE_G = 1000.0


@dataclass(frozen=True)
class FusionResult:
    accepted: bool
    probability: float
    reason: Optional[str] = None


def _posterior(confidence: float, difference_g: float) -> float:
    """bayes update: the camera gives the prior, the load cell gives the evidence"""
    density = math.exp(-0.5 * (difference_g / LOAD_CELL_SIGMA_G) ** 2) / (LOAD_CELL_SIGMA_G * math.sqrt(2 * math.pi))
    item = confidence * density
    other = (1 - confidence) / WEIGHT_RANGE_G
    return item / (item + other) if item + other > 0 else 0.0


def fuse(confidence: float, weight_delta: float, catalog_weight: float) -> FusionResult:
    # written so nan fails the check too
    if not 0 <= confidence <= 1:
        return FusionResult(False, 0.0, "low confidence")
    if not math.isfinite(weight_delta):
        return FusionResult(False, 0.0, "weight mismatch")

    difference = weight_delta - catalog_weight
    probability = _posterior(confidence, difference)
    if confidence < MIN_CONFIDENCE:
        return FusionResult(False, probability, "low confidence")
    # camera says cereal but the scale says brick: reject the addition
    if abs(difference) > WEIGHT_TOLERANCE_G:
        return FusionResult(False, probability, "weight mismatch")
    return FusionResult(True, probability)


def aggregate_burst(frames: list[dict[str, float]]) -> Optional[tuple[str, float]]:
    """one vote per frame for its strongest class. returns the winner and its mean confidence"""
    votes: dict[str, list[float]] = defaultdict(list)
    for scores in frames:
        if scores:
            name = max(scores, key=lambda c: scores[c])
            votes[name].append(scores[name])
    if not votes:
        return None
    winner = max(votes, key=lambda c: (len(votes[c]), sum(votes[c]) / len(votes[c])))
    return winner, sum(votes[winner]) / len(votes[winner])
