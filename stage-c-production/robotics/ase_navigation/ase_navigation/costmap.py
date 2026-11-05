"""the layered costmap from chapter 8.3 of the spec.

static layer: shelves and walls, permanent.
obstacle layer: things the lidar sees right now, shoppers and boxes.
inflation layer: a safety buffer around both, which the robot treats as lethal terrain.
"""
import math
from typing import Iterable

Cell = tuple[int, int]


class LayeredCostmap:
    def __init__(self, width: int, height: int, inflation_radius: int = 0):
        self.width = width
        self.height = height
        self.inflation_radius = inflation_radius
        self._static: set[Cell] = set()
        self._obstacles: set[Cell] = set()
        # how many sources cover each cell. a counter, so clearing a shopper can't remove the
        # buffer of the shelf they were standing next to
        self._coverage: dict[Cell, int] = {}
        self._offsets = [
            (dx, dy)
            for dx in range(-inflation_radius, inflation_radius + 1)
            for dy in range(-inflation_radius, inflation_radius + 1)
            if math.hypot(dx, dy) <= inflation_radius
        ]

    def in_bounds(self, x: int, y: int) -> bool:
        return 0 <= x < self.width and 0 <= y < self.height

    def is_lethal(self, x: int, y: int) -> bool:
        return not self.in_bounds(x, y) or (x, y) in self._coverage

    def _cover(self, cell: Cell, change: int) -> set[Cell]:
        """adds or removes one source, returns the cells whose lethal state flipped"""
        flipped = set()
        for dx, dy in self._offsets:
            target = (cell[0] + dx, cell[1] + dy)
            if not self.in_bounds(*target):
                continue
            count = self._coverage.get(target, 0) + change
            if count > 0:
                if target not in self._coverage:
                    flipped.add(target)
                self._coverage[target] = count
            else:
                self._coverage.pop(target, None)
                flipped.add(target)
        return flipped

    def add_static(self, x: int, y: int) -> set[Cell]:
        if not self.in_bounds(x, y) or (x, y) in self._static:
            return set()
        self._static.add((x, y))
        return self._cover((x, y), 1)

    def add_obstacle(self, x: int, y: int) -> set[Cell]:
        if not self.in_bounds(x, y) or (x, y) in self._obstacles:
            return set()
        self._obstacles.add((x, y))
        return self._cover((x, y), 1)

    def set_obstacles(self, cells: Iterable[Cell]) -> set[Cell]:
        """replaces the obstacle layer with the latest lidar sweep"""
        wanted = {cell for cell in cells if self.in_bounds(*cell)}
        flipped = set()
        for cell in self._obstacles - wanted:
            self._obstacles.discard(cell)
            flipped ^= self._cover(cell, -1)
        for cell in wanted - self._obstacles:
            self._obstacles.add(cell)
            flipped ^= self._cover(cell, 1)
        return flipped

    def clear_obstacles(self) -> set[Cell]:
        return self.set_obstacles([])
