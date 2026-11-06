import math

import pytest

from ase_navigation.ros_adapters import cell_to_world, occupied_cells, scan_cells, world_to_cell, yaw_from_quaternion


def test_occupancy_grid_is_row_by_row():
    # 3 wide: an occupied cell at (2, 0), an unknown at (0, 1)
    assert list(occupied_cells([0, 0, 100, -1, 0, 0], 3)) == [(2, 0), (0, 1)]


def test_low_occupancy_counts_as_free():
    assert list(occupied_cells([10, 49, 50], 3)) == [(2, 0)]


def test_world_and_cell_round_trip_through_the_map_origin():
    cell = world_to_cell(1.26, 0.74, origin_x=-1.0, origin_y=0.0, resolution=0.5)
    assert cell == (4, 1)
    assert cell_to_world(cell, -1.0, 0.0, 0.5) == (1.25, 0.75)


def test_negative_coordinates_are_not_rounded_into_the_map():
    assert world_to_cell(-0.1, -0.1, 0.0, 0.0, 1.0) == (-1, -1)


@pytest.mark.parametrize("yaw", [0.0, math.pi / 2, -math.pi / 2, 3.0])
def test_yaw_from_a_rotation_about_z(yaw):
    assert yaw_from_quaternion(0, 0, math.sin(yaw / 2), math.cos(yaw / 2)) == pytest.approx(yaw)


def sweep(ranges, **overrides):
    values = dict(
        angle_min=0.0, angle_increment=math.pi / 2, range_min=0.1, range_max=10.0,
        pose_x=5.0, pose_y=5.0, yaw=0.0, origin_x=0.0, origin_y=0.0, resolution=1.0,
    )
    values.update(overrides)
    return scan_cells(ranges, **values)


def test_a_reading_lands_in_the_map_where_the_beam_points():
    # straight ahead along +x, then 90 degrees left along +y
    assert sweep([2.0, 3.0]) == {(7, 5), (5, 8)}


def test_the_trolleys_heading_turns_the_sweep():
    assert sweep([2.0], yaw=math.pi / 2) == {(5, 7)}


@pytest.mark.parametrize("reading", [math.inf, math.nan, 0.05, 50.0])
def test_readings_the_sensor_cant_vouch_for_are_ignored(reading):
    assert sweep([reading]) == set()
