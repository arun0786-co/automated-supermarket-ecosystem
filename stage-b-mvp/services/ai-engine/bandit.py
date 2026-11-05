"""contextual bandit from chapter 7.3.2 of the spec: location, cart and time go in,
a recommendation comes out, and the reward is whether the customer added it."""
import math
from typing import Optional

import numpy as np

CATEGORIES = ["Produce", "Dairy", "Bakery", "Pantry", "Beverages", "Snacks", "Meat", "Fish"]
AISLES = 8
DIMENSIONS = 1 + 2 + AISLES + len(CATEGORIES)


def encode_context(aisle: Optional[int], hour: Optional[int], cart_categories: list[str]) -> np.ndarray:
    """bias, time of day on a circle (23:00 is close to 00:00), aisle, cart categories"""
    x = np.zeros(DIMENSIONS)
    x[0] = 1.0
    if hour is not None and 0 <= hour <= 23:
        x[1] = math.sin(2 * math.pi * hour / 24)
        x[2] = math.cos(2 * math.pi * hour / 24)
    if aisle is not None and 0 <= aisle < AISLES:
        x[3 + aisle] = 1.0
    for category in cart_categories:
        if category in CATEGORIES:
            x[3 + AISLES + CATEGORIES.index(category)] = 1.0
    return x


class LinUCB:
    """one linear model per sku. a_inverse is updated in place with sherman-morrison,
    so a reward costs a matrix-vector product instead of a matrix inversion"""

    def __init__(self, alpha: float = 0.3):
        self.alpha = alpha
        self.a_inverse: dict[str, np.ndarray] = {}
        self.b: dict[str, np.ndarray] = {}

    def _arm(self, sku: str):
        if sku not in self.a_inverse:
            return np.identity(DIMENSIONS), np.zeros(DIMENSIONS)
        return self.a_inverse[sku], self.b[sku]

    def score(self, sku: str, x: np.ndarray) -> float:
        a_inverse, b = self._arm(sku)
        return float((a_inverse @ b) @ x + self.alpha * math.sqrt(max(x @ a_inverse @ x, 0.0)))

    def update(self, sku: str, x: np.ndarray, reward: float) -> None:
        a_inverse, b = self._arm(sku)
        product = a_inverse @ x
        self.a_inverse[sku] = a_inverse - np.outer(product, product) / (1.0 + x @ product)
        self.b[sku] = b + reward * x

    def to_json(self) -> dict:
        return {
            "alpha": self.alpha,
            "arms": {sku: {"aInverse": self.a_inverse[sku].tolist(), "b": self.b[sku].tolist()} for sku in self.a_inverse},
        }

    @classmethod
    def from_json(cls, data: dict) -> "LinUCB":
        bandit = cls(alpha=float(data["alpha"]))
        for sku, arm in data["arms"].items():
            a_inverse, b = np.array(arm["aInverse"], dtype=float), np.array(arm["b"], dtype=float)
            if a_inverse.shape != (DIMENSIONS, DIMENSIONS) or b.shape != (DIMENSIONS,):
                raise ValueError(f"bad shape for arm {sku}")
            bandit.a_inverse[sku], bandit.b[sku] = a_inverse, b
        return bandit
