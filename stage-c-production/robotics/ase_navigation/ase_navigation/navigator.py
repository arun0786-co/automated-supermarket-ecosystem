"""chapter 8.4 of the spec: a* when the store is empty, d* lite while people are moving around."""
from enum import Enum
from typing import Iterable, Optional

from .astar import PlanResult, astar
from .costmap import Cell, LayeredCostmap
from .dstar_lite import DStarLite

OPENING_HOUR = 7
CLOSING_HOUR = 22


class Mode(Enum):
    NIGHT = "night"
    OPERATING = "operating"


class Navigator:
    def __init__(self, costmap: LayeredCostmap, mode: Mode):
        self.costmap = costmap
        self.mode = mode
        self._position: Optional[Cell] = None
        self._goal: Optional[Cell] = None
        self._dstar: Optional[DStarLite] = None

    @staticmethod
    def mode_for_hour(hour: int) -> Mode:
        return Mode.OPERATING if OPENING_HOUR <= hour < CLOSING_HOUR else Mode.NIGHT

    @property
    def planner_name(self) -> str:
        return "A*" if self.mode is Mode.NIGHT else "D* Lite"

    def plan(self, start: Cell, goal: Cell) -> Optional[PlanResult]:
        self._position, self._goal = start, goal
        if self.mode is Mode.NIGHT:
            return astar(self.costmap, start, goal)
        self._dstar = DStarLite(self.costmap, start, goal)
        return self._dstar.plan()

    def _replan(self, changed: Iterable[Cell]) -> Optional[PlanResult]:
        if self._goal is None or self._position is None:
            raise RuntimeError("no route to update, call plan first")
        if self.mode is Mode.NIGHT:
            return astar(self.costmap, self._position, self._goal)
        return self._dstar.replan(changed)

    def moved_to(self, cell: Cell) -> Optional[PlanResult]:
        if self._goal is None:
            raise RuntimeError("no route to update, call plan first")
        self._position = cell
        if self._dstar is not None:
            self._dstar.move_to(cell)
        return self._replan(set())

    def obstacle_seen(self, cells: Iterable[Cell]) -> Optional[PlanResult]:
        changed: set[Cell] = set()
        for x, y in cells:
            changed |= self.costmap.add_obstacle(x, y)
        return self._replan(changed)

    def lidar_sweep(self, cells: Iterable[Cell]) -> Optional[PlanResult]:
        """the obstacle layer is whatever the latest sweep sees"""
        return self._replan(self.costmap.set_obstacles(cells))

    def obstacles_cleared(self) -> Optional[PlanResult]:
        return self._replan(self.costmap.clear_obstacles())
