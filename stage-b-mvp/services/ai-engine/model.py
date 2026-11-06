"""item-item collaborative filtering from chapter 7.3.1 of the spec:
"users who bought X also bought Y", learned from baskets."""
import json
import logging
import os
import tempfile
import threading
import time
from typing import Iterable, Optional

import numpy as np

from bandit import LinUCB

log = logging.getLogger("ai-engine")

SYNTHETIC_BASKETS = 2000
# a real basket says more than a generated one
REAL_BASKET_WEIGHT = 20.0
# past this many real baskets the generated ones only add noise
REAL_ONLY_AFTER = 500
RETRAIN_EVERY = 5
SAVE_EVERY_FEEDBACK = 20


class ItemItemModel:
    def __init__(self, skus: list[str]):
        self.skus = list(skus)
        self.index = {sku: i for i, sku in enumerate(self.skus)}
        self.similarity = np.zeros((len(skus), len(skus)))

    def train(self, baskets: Iterable[Iterable[str]], weights: Optional[Iterable[float]] = None) -> None:
        baskets = list(baskets)
        weights = list(weights) if weights is not None else [1.0] * len(baskets)
        co = np.zeros((len(self.skus), len(self.skus)))
        for basket, weight in zip(baskets, weights):
            # a set: three bananas are one signal
            positions = sorted({self.index[sku] for sku in basket if sku in self.index})
            for i in positions:
                for j in positions:
                    co[i, j] += weight
        # cosine, so a bestseller doesn't look related to everything
        norm = np.sqrt(np.diag(co))
        denominator = np.outer(norm, norm)
        self.similarity = np.divide(co, denominator, out=np.zeros_like(co), where=denominator > 0)
        np.fill_diagonal(self.similarity, 0.0)

    def scores(self, cart: Iterable[str]) -> dict[str, float]:
        cart = set(cart)
        positions = [self.index[sku] for sku in cart if sku in self.index]
        total = self.similarity[positions].sum(axis=0) if positions else np.zeros(len(self.skus))
        return {sku: float(total[i]) for i, sku in enumerate(self.skus) if sku not in cart}


def synthetic_baskets(matrix: dict, count: int = SYNTHETIC_BASKETS, seed: int = 7) -> list[list[str]]:
    """generated from the hand-written pairings, so there is something to serve before any real
    purchase has happened. seeded, so the model is the same on every start"""
    rng = np.random.default_rng(seed)
    starts = sorted(matrix)
    baskets = []
    for _ in range(count):
        first = starts[rng.integers(len(starts))]
        basket = {first}
        for related, strength, _reason in matrix[first]:
            if rng.random() < strength:
                basket.add(related)
        baskets.append(sorted(basket))
    return baskets


def _catalog_from(matrix: dict) -> list[str]:
    skus = set(matrix)
    for pairs in matrix.values():
        skus.update(related for related, _strength, _reason in pairs)
    return sorted(skus)


class Trainer:
    """holds the model, the bandit and the anonymous purchase history. baskets are lists of
    skus and nothing else: no customer id ever gets here (chapter 7.4)"""

    def __init__(
        self,
        matrix: dict,
        state_path: Optional[str] = None,
        retrain_every: int = RETRAIN_EVERY,
        real_only_after: int = REAL_ONLY_AFTER,
    ):
        self.state_path = state_path
        self.retrain_every = retrain_every
        self.real_only_after = real_only_after
        self.synthetic = synthetic_baskets(matrix)
        self.seed_skus = _catalog_from(matrix)
        self.model = ItemItemModel(self.seed_skus)
        self.real: list[list[str]] = []
        self.bandit = LinUCB()
        self.feedback_events = 0
        self.pending = 0
        self.last_trained = 0.0
        # fastapi runs the handlers on several threads. save runs inside the other locked methods
        self._lock = threading.RLock()
        self._load()
        self._retrain()

    def _load(self) -> None:
        if not self.state_path or not os.path.exists(self.state_path):
            return
        try:
            with open(self.state_path) as handle:
                state = json.load(handle)
            baskets = state["baskets"]
            if not all(isinstance(b, list) and all(isinstance(s, str) for s in b) for b in baskets):
                raise ValueError("baskets must be lists of skus")
            bandit = LinUCB.from_json(state["bandit"])
            self.real, self.bandit = baskets, bandit
            self.feedback_events = int(state.get("feedbackEvents", 0))
        except (OSError, ValueError, KeyError, TypeError, AttributeError) as err:
            log.warning("ignoring unreadable state file %s: %s", self.state_path, err)

    def save(self) -> None:
        if not self.state_path:
            return
        with self._lock:
            state = {"baskets": self.real, "bandit": self.bandit.to_json(), "feedbackEvents": self.feedback_events}
            # write and rename, so a crash can't leave half a file behind
            try:
                directory = os.path.dirname(self.state_path) or "."
                with tempfile.NamedTemporaryFile("w", dir=directory, delete=False, suffix=".tmp") as handle:
                    json.dump(state, handle)
                os.replace(handle.name, self.state_path)
            except OSError as err:
                log.warning("could not save state: %s", err)

    def _retrain(self) -> None:
        # real baskets can include products the hand-written pairings never mention
        model = ItemItemModel(sorted(set(self.seed_skus).union(*self.real)))
        if len(self.real) >= self.real_only_after:
            model.train(self.real)
        else:
            model.train(
                self.synthetic + self.real,
                [1.0] * len(self.synthetic) + [REAL_BASKET_WEIGHT] * len(self.real),
            )
        # recommendations read this without a lock, so it only goes live once trained
        self.model = model
        self.pending = 0
        self.last_trained = time.time()

    def add_purchase(self, skus: list[str]) -> None:
        basket = sorted(set(skus))
        if len(basket) < 2:
            return
        with self._lock:
            self.real.append(basket)
            self.pending += 1
            if self.pending >= self.retrain_every:
                self._retrain()
                self.save()

    def feedback(self, sku: str, x: np.ndarray, reward: float) -> None:
        self.bandit.update(sku, x, reward)
        with self._lock:
            self.feedback_events += 1
            if self.feedback_events % SAVE_EVERY_FEEDBACK == 0:
                self.save()

    def scores(self, cart: Iterable[str]) -> dict[str, float]:
        return self.model.scores(cart)

    def status(self) -> dict:
        if not self.real:
            trained_on = "synthetic"
        elif len(self.real) >= self.real_only_after:
            trained_on = "real"
        else:
            trained_on = "mixed"
        return {
            "algorithm": "item-item cosine with LinUCB reranking",
            "trainedOn": trained_on,
            "syntheticBaskets": 0 if trained_on == "real" else len(self.synthetic),
            "realBaskets": len(self.real),
            "feedbackEvents": self.feedback_events,
            "lastTrained": self.last_trained,
        }
