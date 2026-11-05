import math
import random

import pytest

from ase_navigation.astar import astar
from ase_navigation.costmap import LayeredCostmap
from ase_navigation.dstar_lite import DStarLite
from ase_navigation.navigator import Mode, Navigator
from ase_navigation.store_floor import BAY, CHECKOUT, SHELVES, store_costmap, to_cell

DIAGONAL = math.sqrt(2)


def path_is_valid(costmap, path):
    assert path, "no path"
    for a, b in zip(path, path[1:]):
        dx, dy = abs(a[0] - b[0]), abs(a[1] - b[1])
        assert max(dx, dy) == 1, f"jump from {a} to {b}"
        assert not costmap.is_lethal(*b), f"path enters {b}"
        if dx == 1 and dy == 1:
            assert not costmap.is_lethal(a[0], b[1]) and not costmap.is_lethal(b[0], a[1]), f"cut the corner at {a} to {b}"
    return True


def length(path):
    return sum(math.hypot(a[0] - b[0], a[1] - b[1]) for a, b in zip(path, path[1:]))


# ---- layered costmap, chapter 8.3 ----

def test_static_layer_is_permanent_and_obstacles_are_not():
    costmap = LayeredCostmap(10, 10, inflation_radius=0)
    costmap.add_static(3, 3)
    costmap.add_obstacle(5, 5)
    assert costmap.is_lethal(3, 3) and costmap.is_lethal(5, 5)
    costmap.clear_obstacles()
    assert costmap.is_lethal(3, 3)
    assert not costmap.is_lethal(5, 5)


def test_inflation_makes_a_safety_buffer_around_both_layers():
    costmap = LayeredCostmap(20, 20, inflation_radius=2)
    costmap.add_static(10, 10)
    costmap.add_obstacle(4, 4)
    for centre in [(10, 10), (4, 4)]:
        assert costmap.is_lethal(centre[0] + 2, centre[1])
        assert costmap.is_lethal(centre[0], centre[1] - 2)
        assert not costmap.is_lethal(centre[0] + 3, centre[1])


def test_clearing_an_obstacle_clears_its_buffer_but_not_a_shelf_nearby():
    costmap = LayeredCostmap(20, 20, inflation_radius=2)
    costmap.add_static(10, 10)
    costmap.add_obstacle(12, 10)
    assert costmap.is_lethal(14, 10)
    costmap.clear_obstacles()
    assert not costmap.is_lethal(14, 10)
    assert costmap.is_lethal(12, 10)  # still inside the shelf's own buffer


def test_outside_the_map_is_lethal():
    costmap = LayeredCostmap(5, 5)
    for cell in [(-1, 0), (0, -1), (5, 0), (0, 5)]:
        assert costmap.is_lethal(*cell)


def test_obstacles_outside_the_map_are_ignored():
    costmap = LayeredCostmap(5, 5, inflation_radius=1)
    costmap.add_obstacle(100, 100)
    assert not costmap.is_lethal(4, 4)


def test_changes_report_which_cells_changed():
    costmap = LayeredCostmap(10, 10, inflation_radius=1)
    assert costmap.add_obstacle(5, 5) == {(x, y) for x in (4, 5, 6) for y in (4, 5, 6) if math.hypot(x - 5, y - 5) <= 1}
    assert costmap.add_obstacle(5, 5) == set()


# ---- a*, chapter 8.4 ----

def test_astar_straight_line_is_optimal():
    result = astar(LayeredCostmap(20, 20), (0, 0), (10, 0))
    assert result.cost == pytest.approx(10)
    assert result.path[0] == (0, 0) and result.path[-1] == (10, 0)


def test_astar_diagonal_is_optimal():
    assert astar(LayeredCostmap(20, 20), (0, 0), (7, 7)).cost == pytest.approx(7 * DIAGONAL)


def test_astar_mixed_is_optimal():
    assert astar(LayeredCostmap(20, 20), (0, 0), (10, 3)).cost == pytest.approx(3 * DIAGONAL + 7)


def test_astar_goes_around_a_wall():
    costmap = LayeredCostmap(10, 10)
    for y in range(0, 8):
        costmap.add_static(5, y)
    result = astar(costmap, (0, 0), (9, 0))
    assert path_is_valid(costmap, result.path)
    assert result.cost > 9


def test_never_cuts_a_corner_through_a_shelf_edge():
    costmap = LayeredCostmap(5, 5)
    costmap.add_static(1, 0)
    costmap.add_static(0, 1)
    assert astar(costmap, (0, 0), (1, 1)) is None


def test_start_equals_goal():
    result = astar(LayeredCostmap(5, 5), (2, 2), (2, 2))
    assert result.path == [(2, 2)]
    assert result.cost == 0


@pytest.mark.parametrize("planner", ["astar", "dstar"])
def test_a_walled_off_goal_has_no_path_instead_of_hanging(planner):
    costmap = LayeredCostmap(10, 10)
    for x in range(0, 10):
        costmap.add_static(x, 5)
    if planner == "astar":
        assert astar(costmap, (0, 0), (0, 9)) is None
    else:
        assert DStarLite(costmap, (0, 0), (0, 9)).plan() is None


@pytest.mark.parametrize("planner", ["astar", "dstar"])
@pytest.mark.parametrize("start,goal", [((3, 3), (8, 8)), ((8, 8), (3, 3))])
def test_starting_or_ending_on_an_obstacle_has_no_path(planner, start, goal):
    costmap = LayeredCostmap(10, 10)
    costmap.add_static(3, 3)
    if planner == "astar":
        assert astar(costmap, start, goal) is None
    else:
        assert DStarLite(costmap, start, goal).plan() is None


# ---- d* lite, chapter 8.4 ----

def random_map(rng, size=30, density=0.2, inflation=0):
    costmap = LayeredCostmap(size, size, inflation_radius=inflation)
    for x in range(size):
        for y in range(size):
            if rng.random() < density and (x, y) not in ((0, 0), (size - 1, size - 1)):
                costmap.add_static(x, y)
    return costmap


@pytest.mark.parametrize("seed", range(25))
def test_dstar_matches_astar_on_random_maps(seed):
    costmap = random_map(random.Random(seed))
    fresh = astar(costmap, (0, 0), (29, 29))
    planned = DStarLite(costmap, (0, 0), (29, 29)).plan()
    if fresh is None:
        assert planned is None
    else:
        assert path_is_valid(costmap, planned.path)
        assert planned.cost == pytest.approx(fresh.cost)


@pytest.mark.parametrize("seed", range(25))
def test_dstar_replans_to_the_same_cost_as_starting_over(seed):
    rng = random.Random(1000 + seed)
    costmap = random_map(rng, density=0.15)
    planner = DStarLite(costmap, (0, 0), (29, 29))
    planner.plan()
    for _ in range(6):
        changed = set()
        for _ in range(8):
            x, y = rng.randrange(30), rng.randrange(30)
            if (x, y) not in ((0, 0), (29, 29)):
                changed |= costmap.add_obstacle(x, y) | {(x, y)}
        planned = planner.replan(changed)
        fresh = astar(costmap, (0, 0), (29, 29))
        if fresh is None:
            assert planned is None
        else:
            assert path_is_valid(costmap, planned.path)
            assert planned.cost == pytest.approx(fresh.cost)


@pytest.mark.parametrize("seed", range(10))
def test_dstar_finds_the_shorter_way_when_an_obstacle_clears(seed):
    rng = random.Random(2000 + seed)
    costmap = random_map(rng, density=0.1)
    planner = DStarLite(costmap, (0, 0), (29, 29))
    planner.plan()
    changed = set()
    for _ in range(25):
        changed |= costmap.add_obstacle(rng.randrange(1, 29), rng.randrange(1, 29))
    planner.replan(changed)
    changed = costmap.clear_obstacles()
    planned = planner.replan(changed)
    assert planned.cost == pytest.approx(astar(costmap, (0, 0), (29, 29)).cost)


@pytest.mark.parametrize("seed", range(10))
def test_dstar_stays_correct_while_the_trolley_moves(seed):
    rng = random.Random(3000 + seed)
    costmap = random_map(rng, density=0.1)
    planner = DStarLite(costmap, (0, 0), (29, 29))
    planned = planner.plan()
    while planned and planned.path[0] != (29, 29):
        step = planned.path[1 if len(planned.path) > 1 else 0]
        x, y = rng.randrange(30), rng.randrange(30)
        changed = set()
        if (x, y) not in (step, (29, 29)):
            changed = costmap.add_obstacle(x, y)
        planner.move_to(step)
        planned = planner.replan(changed)
        fresh = astar(costmap, step, (29, 29))
        if fresh is None:
            assert planned is None
            return
        assert planned.cost == pytest.approx(fresh.cost)


def replan_after_obstacle_ahead(costmap, start, goal, ahead):
    """a person steps onto the route, as seen by the trolley's own lidar"""
    planner = DStarLite(costmap, start, goal)
    route = planner.plan().path
    here = route[1]
    planner.move_to(here)
    planned = planner.replan(costmap.add_obstacle(*route[ahead]))
    fresh = astar(costmap, here, goal)
    assert planned.cost == pytest.approx(fresh.cost)
    return planner.last_expansions, fresh.expansions


# measured, and the reason the spec picks d* for operating hours. d* lite searches back from the
# goal, so a change near the robot only disturbs the end of its search
def test_on_the_store_floor_dstar_replans_far_cheaper_than_starting_over():
    dstar, fresh = replan_after_obstacle_ahead(store_costmap(), BAY, (75, 54), ahead=5)
    assert dstar * 20 < fresh, f"d* {dstar}, a* {fresh}"


# and the reason it picks a* for night mode: with nothing in the way a* barely has to search
def test_on_an_empty_floor_starting_over_with_astar_is_no_worse():
    dstar, fresh = replan_after_obstacle_ahead(LayeredCostmap(120, 120, inflation_radius=1), (5, 60), (115, 60), ahead=5)
    assert fresh <= dstar, f"d* {dstar}, a* {fresh}"


def test_replanning_with_no_changes_does_nothing():
    costmap = LayeredCostmap(30, 30)
    planner = DStarLite(costmap, (0, 0), (29, 29))
    first = planner.plan()
    again = planner.replan(set())
    assert again.path == first.path
    assert planner.last_expansions == 0


# ---- the store ----

def test_every_shelf_is_lethal():
    costmap = store_costmap()
    for x, y, width, height in SHELVES:
        assert costmap.is_lethal(*to_cell(x + width / 2, y + height / 2))


def test_the_bay_and_the_checkout_are_clear():
    costmap = store_costmap()
    assert not costmap.is_lethal(*BAY)
    assert not costmap.is_lethal(*CHECKOUT)


def test_a_trolley_can_get_from_the_bay_to_the_checkout_keeping_clear_of_shelves():
    costmap = store_costmap()
    result = astar(costmap, BAY, CHECKOUT)
    assert path_is_valid(costmap, result.path)


def test_coordinates_match_the_dashboard_map():
    assert to_cell(0, 0) == (0, 0)
    assert to_cell(799, 599) == (79, 59)
    assert to_cell(100000, -5) == (79, 0)


# ---- which planner when, chapter 8.4 ----

def test_mode_follows_store_hours():
    assert Navigator.mode_for_hour(2) is Mode.NIGHT
    assert Navigator.mode_for_hour(23) is Mode.NIGHT
    assert Navigator.mode_for_hour(8) is Mode.OPERATING
    assert Navigator.mode_for_hour(21) is Mode.OPERATING


def test_night_mode_uses_astar_and_operating_hours_use_dstar():
    night = Navigator(store_costmap(), Mode.NIGHT)
    night.plan(BAY, CHECKOUT)
    assert night.planner_name == "A*"
    day = Navigator(store_costmap(), Mode.OPERATING)
    day.plan(BAY, CHECKOUT)
    assert day.planner_name == "D* Lite"


@pytest.mark.parametrize("mode", [Mode.NIGHT, Mode.OPERATING])
def test_a_shopper_stepping_into_the_path_triggers_a_new_route_around_them(mode):
    navigator = Navigator(store_costmap(), mode)
    first = navigator.plan(BAY, CHECKOUT)
    midpoint = first.path[len(first.path) // 2]
    second = navigator.obstacle_seen([midpoint])
    assert midpoint not in second.path
    assert path_is_valid(navigator.costmap, second.path)
    assert second.cost >= first.cost


@pytest.mark.parametrize("mode", [Mode.NIGHT, Mode.OPERATING])
def test_a_shopper_blocking_everything_gives_no_route_not_a_crash(mode):
    navigator = Navigator(LayeredCostmap(10, 10), mode)
    navigator.plan((0, 0), (9, 0))
    assert navigator.obstacle_seen([(5, y) for y in range(10)]) is None


@pytest.mark.parametrize("mode", [Mode.NIGHT, Mode.OPERATING])
def test_the_route_returns_when_the_shopper_moves_on(mode):
    navigator = Navigator(LayeredCostmap(10, 10), mode)
    first = navigator.plan((0, 0), (9, 0))
    assert navigator.obstacle_seen([(5, y) for y in range(10)]) is None
    assert navigator.obstacles_cleared().cost == pytest.approx(first.cost)


def test_moving_before_planning_is_refused():
    navigator = Navigator(LayeredCostmap(10, 10), Mode.OPERATING)
    with pytest.raises(RuntimeError):
        navigator.moved_to((1, 1))
