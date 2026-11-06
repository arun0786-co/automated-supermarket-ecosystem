"""turns ros message contents into grid cells. no ros imports, so it can be tested anywhere."""
import math
from typing import Iterable, Sequence

from .costmap import Cell

# nav_msgs/OccupancyGrid: -1 unknown, 0 free, 100 occupied
OCCUPIED_FROM = 50


def occupied_cells(data: Sequence[int], width: int) -> Iterable[Cell]:
    """unknown cells count as occupied: a trolley shouldn't drive into what the map hasn't seen"""
    for index, value in enumerate(data):
        if value < 0 or value >= OCCUPIED_FROM:
            yield (index % width, index // width)


def world_to_cell(x: float, y: float, origin_x: float, origin_y: float, resolution: float) -> Cell:
    return (math.floor((x - origin_x) / resolution), math.floor((y - origin_y) / resolution))


def cell_to_world(cell: Cell, origin_x: float, origin_y: float, resolution: float) -> tuple[float, float]:
    return (origin_x + (cell[0] + 0.5) * resolution, origin_y + (cell[1] + 0.5) * resolution)


def yaw_from_quaternion(x: float, y: float, z: float, w: float) -> float:
    return math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))


def scan_cells(
    ranges: Sequence[float],
    angle_min: float,
    angle_increment: float,
    range_min: float,
    range_max: float,
    pose_x: float,
    pose_y: float,
    yaw: float,
    origin_x: float,
    origin_y: float,
    resolution: float,
) -> set[Cell]:
    """the cells a 2d lidar sweep hit. readings outside the sensor's range mean nothing was there"""
    cells = set()
    for index, distance in enumerate(ranges):
        if not math.isfinite(distance) or not range_min <= distance <= range_max:
            continue
        angle = yaw + angle_min + index * angle_increment
        cells.add(
            world_to_cell(
                pose_x + distance * math.cos(angle),
                pose_y + distance * math.sin(angle),
                origin_x,
                origin_y,
                resolution,
            )
        )
    return cells
