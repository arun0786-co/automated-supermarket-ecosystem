import json
import sys
import threading

import numpy as np
import pytest

from bandit import LinUCB, encode_context
from model import ItemItemModel, Trainer, synthetic_baskets

SKUS = ["A", "B", "C", "D"]


def test_items_bought_together_rank_first():
    model = ItemItemModel(SKUS)
    model.train([["A", "B"]] * 10 + [["C", "D"]] * 10 + [["A", "C"]])
    scores = model.scores(["A"])
    assert max(scores, key=lambda s: scores[s]) == "B"
    assert scores["B"] > scores["C"] > 0
    assert scores["D"] == 0


def test_cart_items_are_never_scored():
    model = ItemItemModel(SKUS)
    model.train([["A", "B", "C"]] * 5)
    assert set(model.scores(["A", "B"])) == {"C", "D"}


def test_several_cart_items_add_up():
    model = ItemItemModel(SKUS)
    model.train([["A", "C"]] * 5 + [["B", "C"]] * 5 + [["A", "D"]] * 5)
    scores = model.scores(["A", "B"])
    assert scores["C"] > scores["D"]


def test_popular_items_do_not_win_just_by_being_popular():
    # D is in every basket, but B goes with A far more specifically
    model = ItemItemModel(SKUS)
    model.train([["A", "B", "D"]] * 5 + [["C", "D"]] * 100)
    scores = model.scores(["A"])
    assert scores["B"] > scores["D"]


def test_skus_outside_the_catalog_are_ignored():
    model = ItemItemModel(SKUS)
    model.train([["A", "B", "GHOST"]] * 3)
    assert "GHOST" not in model.scores(["A"])
    assert model.scores(["GHOST"]) == {"A": 0.0, "B": 0.0, "C": 0.0, "D": 0.0}


def test_duplicates_in_a_basket_count_once():
    once = ItemItemModel(SKUS)
    once.train([["A", "B"]])
    twice = ItemItemModel(SKUS)
    twice.train([["A", "A", "A", "B"]])
    assert once.scores(["A"]) == pytest.approx(twice.scores(["A"]))


def test_no_training_data_scores_zero_without_dividing_by_zero():
    model = ItemItemModel(SKUS)
    model.train([])
    assert model.scores(["A"]) == {"B": 0.0, "C": 0.0, "D": 0.0}


MATRIX = {"A": [("B", 0.9, "ab")], "C": [("D", 0.9, "cd")]}


def test_synthetic_baskets_follow_the_matrix_and_are_repeatable():
    first = synthetic_baskets(MATRIX, count=500)
    assert first == synthetic_baskets(MATRIX, count=500)
    together = sum(1 for basket in first if "A" in basket and "B" in basket)
    apart = sum(1 for basket in first if "A" in basket and "D" in basket)
    assert together > apart


def trainer(tmp_path=None, **kwargs):
    state = str(tmp_path / "state.json") if tmp_path else None
    return Trainer(MATRIX, state_path=state, **kwargs)


def test_cold_start_says_it_is_synthetic():
    t = trainer()
    assert t.status()["trainedOn"] == "synthetic"
    assert t.status()["realBaskets"] == 0
    assert t.scores(["A"])["B"] > 0


def test_real_purchases_change_the_ranking_and_the_label():
    t = trainer(retrain_every=1)
    assert t.scores(["A"])["B"] > t.scores(["A"])["D"]
    for _ in range(100):
        t.add_purchase(["A", "D"])
    assert t.status()["trainedOn"] == "mixed"
    assert t.status()["realBaskets"] == 100
    assert t.scores(["A"])["D"] > t.scores(["A"])["B"]


def test_enough_real_data_drops_the_synthetic_baskets():
    t = trainer(retrain_every=1, real_only_after=5)
    for _ in range(5):
        t.add_purchase(["A", "D"])
    assert t.status()["trainedOn"] == "real"
    assert t.scores(["A"])["B"] == 0


def test_real_purchases_can_teach_items_the_seed_data_never_mentioned():
    t = trainer(retrain_every=1)
    t.add_purchase(["A", "NEW-ITEM"])
    assert t.scores(["A"])["NEW-ITEM"] > 0


def test_single_item_baskets_teach_nothing_and_are_not_stored():
    t = trainer(retrain_every=1)
    t.add_purchase(["A"])
    t.add_purchase([])
    assert t.status()["realBaskets"] == 0


def test_baskets_hold_only_skus(tmp_path):
    t = trainer(tmp_path, retrain_every=1)
    t.add_purchase(["A", "B"])
    t.save()
    saved = json.loads((tmp_path / "state.json").read_text())
    assert saved["baskets"] == [["A", "B"]]
    assert "user" not in json.dumps(saved).lower()


def test_state_survives_a_restart(tmp_path):
    t = trainer(tmp_path, retrain_every=1)
    for _ in range(100):
        t.add_purchase(["A", "D"])
    t.save()
    again = trainer(tmp_path, retrain_every=1)
    assert again.status()["realBaskets"] == 100
    assert again.scores(["A"])["D"] > again.scores(["A"])["B"]


@pytest.mark.parametrize("content", ["{broken", '{"baskets": "nope"}', '{"baskets": [1, 2]}', "[]"])
def test_a_corrupt_state_file_falls_back_to_synthetic(tmp_path, content):
    (tmp_path / "state.json").write_text(content)
    t = trainer(tmp_path)
    assert t.status()["trainedOn"] == "synthetic"
    assert t.scores(["A"])["B"] > 0


def test_a_save_failure_is_not_fatal(tmp_path):
    t = Trainer(MATRIX, state_path=str(tmp_path / "missing-dir" / "state.json"))
    t.add_purchase(["A", "B"])
    t.save()  # logs and carries on


# ---- contextual bandit, chapter 7.3.2 ----

AISLE_4_EVENING = encode_context(aisle=4, hour=18, cart_categories=["Pantry"])
AISLE_1_MORNING = encode_context(aisle=1, hour=8, cart_categories=["Bakery"])


def test_context_vector_has_a_fixed_size_and_tolerates_nonsense():
    size = len(AISLE_4_EVENING)
    assert size == len(encode_context(aisle=None, hour=None, cart_categories=[]))
    assert size == len(encode_context(aisle=999, hour=99, cart_categories=["Not A Category"]))
    assert np.all(np.isfinite(encode_context(aisle=-5, hour=-1, cart_categories=["x"] * 50)))


def test_rewarded_action_wins_in_its_own_context():
    bandit = LinUCB(alpha=0.1)
    for _ in range(30):
        bandit.update("WINE", AISLE_4_EVENING, 1)
        bandit.update("BASIL", AISLE_4_EVENING, 0)
    assert bandit.score("WINE", AISLE_4_EVENING) > bandit.score("BASIL", AISLE_4_EVENING)


def test_what_is_learned_in_one_context_does_not_carry_to_another():
    bandit = LinUCB(alpha=0.1)
    for _ in range(30):
        bandit.update("WINE", AISLE_4_EVENING, 1)
        bandit.update("BASIL", AISLE_4_EVENING, 0)
        bandit.update("BASIL", AISLE_1_MORNING, 1)
        bandit.update("WINE", AISLE_1_MORNING, 0)
    assert bandit.score("BASIL", AISLE_1_MORNING) > bandit.score("WINE", AISLE_1_MORNING)
    assert bandit.score("WINE", AISLE_4_EVENING) > bandit.score("BASIL", AISLE_4_EVENING)


def test_unseen_action_gets_an_exploration_bonus():
    bandit = LinUCB(alpha=1.0)
    for _ in range(50):
        bandit.update("TRIED", AISLE_4_EVENING, 0)
    assert bandit.score("NEVER_TRIED", AISLE_4_EVENING) > bandit.score("TRIED", AISLE_4_EVENING)


def test_bandit_round_trips_through_json():
    bandit = LinUCB(alpha=0.1)
    bandit.update("WINE", AISLE_4_EVENING, 1)
    restored = LinUCB.from_json(json.loads(json.dumps(bandit.to_json())))
    assert restored.score("WINE", AISLE_4_EVENING) == pytest.approx(bandit.score("WINE", AISLE_4_EVENING))


def test_bandit_state_survives_a_restart(tmp_path):
    t = trainer(tmp_path)
    for _ in range(20):
        t.feedback("B", AISLE_4_EVENING, 1)
    t.save()
    again = trainer(tmp_path)
    assert again.bandit.score("B", AISLE_4_EVENING) == pytest.approx(t.bandit.score("B", AISLE_4_EVENING))
    assert again.status()["feedbackEvents"] == 20


# fastapi runs these handlers in a thread pool, so a new product can arrive while the state saves
def test_feedback_from_many_threads_at_once(tmp_path):
    t = trainer(tmp_path)
    workers, each = 8, 60
    errors = []
    start = threading.Barrier(workers)

    def send(worker):
        start.wait()
        try:
            for i in range(each):
                sku = f"SKU-{worker}-{i}"
                t.feedback(sku, AISLE_4_EVENING, 1)
                t.bandit.score(sku, AISLE_4_EVENING)
        except Exception as err:
            errors.append(repr(err))

    interval = sys.getswitchinterval()
    sys.setswitchinterval(1e-5)
    try:
        threads = [threading.Thread(target=send, args=(w,)) for w in range(workers)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
    finally:
        sys.setswitchinterval(interval)

    assert errors == []
    assert t.feedback_events == workers * each
    assert len(t.bandit.a_inverse) == workers * each
    t.save()
    assert len(trainer(tmp_path).bandit.a_inverse) == workers * each


def test_retraining_never_publishes_an_untrained_model(monkeypatch):
    t = trainer(retrain_every=1)
    published = []
    train = ItemItemModel.train

    def spy(self, *args, **kwargs):
        published.append(t.model is self)
        train(self, *args, **kwargs)

    monkeypatch.setattr(ItemItemModel, "train", spy)
    t.add_purchase(["A", "B"])
    assert published == [False]
