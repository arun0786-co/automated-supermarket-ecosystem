"""a* from chapter 8.4 of the spec: optimal paths when the store is empty."""
import heapq
import math
from dataclasses import dataclass
from typing import Iterator, Optional

from .costmap import Cell, LayeredCostmap

DIAGONAL = math.sqrt(2)
MOVES = [(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)]


@dataclass
class PlanResult:
    path: list[Cell]
    cost: float
    expansions: int = 0


def octile(a: Cell, b: Cell) -> float:
    """the exact distance on an empty 8-connected grid, so it never overestimates"""
    dx, dy = abs(a[0] - b[0]), abs(a[1] - b[1])
    return max(dx, dy) + (DIAGONAL - 1) * min(dx, dy)


def neighbours(costmap: LayeredCostmap, cell: Cell) -> Iterator[tuple[Cell, float]]:
    """cells the trolley can move to. a diagonal needs both sides clear, a trolley has width"""
    x, y = cell
    for dx, dy in MOVES:
        target = (x + dx, y + dy)
        if costmap.is_lethal(*target):
            continue
        if dx and dy:
            if costmap.is_lethal(x + dx, y) or costmap.is_lethal(x, y + dy):
                continue
            yield target, DIAGONAL
        else:
            yield target, 1.0


def astar(costmap: LayeredCostmap, start: Cell, goal: Cell) -> Optional[PlanResult]:
    if costmap.is_lethal(*start) or costmap.is_lethal(*goal):
        return None
    best = {start: 0.0}
    came_from: dict[Cell, Cell] = {}
    frontier = [(octile(start, goal), 0.0, start)]
    expansions = 0
    while frontier:
        _, cost, cell = heapq.heappop(frontier)
        if cost > best[cell]:
            continue  # a stale entry, a shorter way here was found since
        expansions += 1
        if cell == goal:
            path = [cell]
            while path[-1] != start:
                path.append(came_from[path[-1]])
            return PlanResult(path[::-1], cost, expansions)
        for target, step in neighbours(costmap, cell):
            candidate = cost + step
            if candidate < best.get(target, math.inf):
                best[target] = candidate
                came_from[target] = cell
                heapq.heappush(frontier, (candidate + octile(target, goal), candidate, target))
    return None
