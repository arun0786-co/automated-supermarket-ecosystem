"""d* lite (koenig and likhachev, 2002), chapter 8.4 of the spec: when a person steps into a free
path, only the part of the plan that person affects gets recalculated.

it searches backwards from the goal. g is the known cost to the goal, rhs is a one step lookahead
at it. a cell needs attention when the two disagree, and a change on the map only disturbs the
cells near it.
"""
import heapq
import math
from typing import Iterable, Optional

from .astar import MOVES, PlanResult
from .costmap import Cell, LayeredCostmap

INF = math.inf
# whole numbers on purpose. the algorithm depends on exact ties between keys, and adding diagonal
# steps of sqrt(2) in a different order gives floats that differ by 1e-15, which makes it stop
# too early and lose paths. this scale is far finer than any two real routes can differ by
STRAIGHT = 1_000_000
DIAGONAL_STEP = 1_414_214


def _distance(a: Cell, b: Cell) -> int:
    dx, dy = abs(a[0] - b[0]), abs(a[1] - b[1])
    return STRAIGHT * max(dx, dy) + (DIAGONAL_STEP - STRAIGHT) * min(dx, dy)


class DStarLite:
    def __init__(self, costmap: LayeredCostmap, start: Cell, goal: Cell):
        self.costmap = costmap
        self.start = start
        self.goal = goal
        self.g: dict[Cell, float] = {}
        self.rhs: dict[Cell, float] = {goal: 0}
        self.km = 0
        self.queue: list[tuple[tuple[float, float], Cell]] = []
        # the live key of each queued cell. older heap entries are skipped when they surface
        self.queued: dict[Cell, tuple[float, float]] = {}
        self.last_expansions = 0
        self._last_start = start
        self._push(goal)

    def _key(self, cell: Cell) -> tuple[float, float]:
        low = min(self.g.get(cell, INF), self.rhs.get(cell, INF))
        return (low + _distance(self.start, cell) + self.km, low)

    def _push(self, cell: Cell) -> None:
        key = self._key(cell)
        self.queued[cell] = key
        heapq.heappush(self.queue, (key, cell))

    def _top(self) -> Optional[tuple[tuple[float, float], Cell]]:
        while self.queue:
            key, cell = self.queue[0]
            if self.queued.get(cell) == key:
                return key, cell
            heapq.heappop(self.queue)
        return None

    def _edge(self, a: Cell, b: Cell) -> float:
        """the cost of moving between two adjacent cells, under the same rules as a*"""
        if self.costmap.is_lethal(*a) or self.costmap.is_lethal(*b):
            return INF
        dx, dy = b[0] - a[0], b[1] - a[1]
        if dx and dy:
            if self.costmap.is_lethal(a[0] + dx, a[1]) or self.costmap.is_lethal(a[0], a[1] + dy):
                return INF
            return DIAGONAL_STEP
        return STRAIGHT

    def _adjacent(self, cell: Cell) -> Iterable[Cell]:
        for dx, dy in MOVES:
            target = (cell[0] + dx, cell[1] + dy)
            if self.costmap.in_bounds(*target):
                yield target

    def _lookahead(self, cell: Cell) -> float:
        return min((self._edge(cell, other) + self.g.get(other, INF) for other in self._adjacent(cell)), default=INF)

    def _update(self, cell: Cell) -> None:
        if cell != self.goal:
            self.rhs[cell] = self._lookahead(cell)
        if self.g.get(cell, INF) != self.rhs.get(cell, INF):
            self._push(cell)
        else:
            self.queued.pop(cell, None)

    def _settle(self) -> None:
        expansions = 0
        while True:
            top = self._top()
            start_consistent = self.rhs.get(self.start, INF) == self.g.get(self.start, INF)
            if top is None or (top[0] >= self._key(self.start) and start_consistent):
                break
            old_key, cell = top
            new_key = self._key(cell)
            if old_key < new_key:
                self._push(cell)
                continue
            heapq.heappop(self.queue)
            self.queued.pop(cell, None)
            expansions += 1
            if self.g.get(cell, INF) > self.rhs.get(cell, INF):
                self.g[cell] = self.rhs[cell]
                for other in self._adjacent(cell):
                    self._update(other)
            else:
                self.g[cell] = INF
                self._update(cell)
                for other in self._adjacent(cell):
                    self._update(other)
        self.last_expansions = expansions

    def _extract(self) -> Optional[PlanResult]:
        if self.costmap.is_lethal(*self.start) or self.costmap.is_lethal(*self.goal):
            return None
        if self.rhs.get(self.start, INF) == INF and self.g.get(self.start, INF) == INF:
            return None
        path = [self.start]
        cost = 0.0
        seen = {self.start}
        while path[-1] != self.goal:
            here = path[-1]
            best_total, best_cell = INF, None
            for other in self._adjacent(here):
                total = self._edge(here, other) + self.g.get(other, INF)
                if total < best_total:
                    best_total, best_cell = total, other
            if best_cell is None or best_cell in seen:
                return None
            seen.add(best_cell)
            path.append(best_cell)
            cost += math.hypot(best_cell[0] - here[0], best_cell[1] - here[1])
        return PlanResult(path, cost, self.last_expansions)

    def plan(self) -> Optional[PlanResult]:
        self._settle()
        return self._extract()

    def move_to(self, cell: Cell) -> None:
        """the trolley moved. the queue stays valid by shifting km rather than rebuilding it"""
        self.start = cell

    def replan(self, changed: Iterable[Cell]) -> Optional[PlanResult]:
        changed = set(changed)
        if self.start != self._last_start:
            self.km += _distance(self._last_start, self.start)
            self._last_start = self.start
        # a flipped cell changes its own edges, and a diagonal between its neighbours can pass by it
        touched = set()
        for x, y in changed:
            for dx in range(-1, 2):
                for dy in range(-1, 2):
                    cell = (x + dx, y + dy)
                    if self.costmap.in_bounds(*cell):
                        touched.add(cell)
        for cell in touched:
            self._update(cell)
        return self.plan()
