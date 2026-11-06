"""the store floor as a costmap. same 800x600 layout as the dashboard's map. on a real trolley this
comes from the slam map instead."""
from .costmap import Cell, LayeredCostmap

CELL_SIZE = 10
WIDTH_CELLS = 80
HEIGHT_CELLS = 60
# the buffer around anything solid, in cells. half a trolley's width plus some margin
INFLATION_CELLS = 2

# x, y, width, height in floor units, from web-dashboard/src/components/StoreMap.tsx
SHELVES = [
    (80, 110, 120, 30),
    (250, 110, 120, 30),
    (420, 110, 120, 30),
    (590, 110, 120, 30),
    (80, 220, 30, 180),
    (230, 220, 30, 180),
    (380, 220, 30, 180),
    (530, 220, 30, 180),
    (680, 220, 30, 180),
    (80, 480, 630, 22),
]

BAY: Cell = (4, 4)
CHECKOUT: Cell = (40, 54)


def to_cell(x: float, y: float) -> Cell:
    return (
        min(max(int(x // CELL_SIZE), 0), WIDTH_CELLS - 1),
        min(max(int(y // CELL_SIZE), 0), HEIGHT_CELLS - 1),
    )


def store_costmap() -> LayeredCostmap:
    costmap = LayeredCostmap(WIDTH_CELLS, HEIGHT_CELLS, inflation_radius=INFLATION_CELLS)
    for x, y, width, height in SHELVES:
        left, top = to_cell(x, y)
        right, bottom = to_cell(x + width - 1, y + height - 1)
        for cell_x in range(left, right + 1):
            for cell_y in range(top, bottom + 1):
                costmap.add_static(cell_x, cell_y)
    return costmap
