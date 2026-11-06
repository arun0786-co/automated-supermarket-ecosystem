"""ros 2 node around the planners (chapter 8.2).

in:  map (nav_msgs/OccupancyGrid), pose and goal_pose (geometry_msgs/PoseStamped),
     scan (sensor_msgs/LaserScan)
out: plan (nav_msgs/Path), empty when there is no route

localisation is someone else's job: on the trolley a slam node publishes map and pose.
"""
from datetime import datetime
from typing import Optional

import rclpy
from geometry_msgs.msg import PoseStamped
from nav_msgs.msg import OccupancyGrid, Path
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile
from sensor_msgs.msg import LaserScan

from .astar import PlanResult
from .costmap import Cell, LayeredCostmap
from .navigator import Mode, Navigator
from .ros_adapters import cell_to_world, occupied_cells, scan_cells, world_to_cell, yaw_from_quaternion


class NavigationNode(Node):
    def __init__(self):
        super().__init__("ase_navigation")
        self.declare_parameter("inflation_cells", 2)
        # auto follows store hours, night or operating force one planner
        self.declare_parameter("mode", "auto")

        self.navigator: Optional[Navigator] = None
        self.info = None
        self.pose: Optional[PoseStamped] = None
        self.goal: Optional[Cell] = None
        self.position: Optional[Cell] = None

        # a map is published once and has to reach nodes that start later
        latched = QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL)
        self.create_subscription(OccupancyGrid, "map", self.on_map, latched)
        self.create_subscription(PoseStamped, "pose", self.on_pose, 10)
        self.create_subscription(PoseStamped, "goal_pose", self.on_goal, 10)
        self.create_subscription(LaserScan, "scan", self.on_scan, 10)
        self.plan_publisher = self.create_publisher(Path, "plan", latched)

    def _mode(self) -> Mode:
        chosen = self.get_parameter("mode").value
        if chosen == "night":
            return Mode.NIGHT
        if chosen == "operating":
            return Mode.OPERATING
        return Navigator.mode_for_hour(datetime.now().hour)

    def _cell(self, x: float, y: float) -> Cell:
        origin = self.info.origin.position
        return world_to_cell(x, y, origin.x, origin.y, self.info.resolution)

    def on_map(self, message: OccupancyGrid) -> None:
        self.info = message.info
        costmap = LayeredCostmap(
            message.info.width,
            message.info.height,
            inflation_radius=self.get_parameter("inflation_cells").value,
        )
        for x, y in occupied_cells(message.data, message.info.width):
            costmap.add_static(x, y)
        self.navigator = Navigator(costmap, self._mode())
        self.get_logger().info(f"map loaded, planning with {self.navigator.planner_name}")
        self._plan()

    def on_pose(self, message: PoseStamped) -> None:
        self.pose = message
        if self.info is None:
            return
        cell = self._cell(message.pose.position.x, message.pose.position.y)
        if cell == self.position:
            return
        had_route = self.goal is not None and self.position is not None
        self.position = cell
        if had_route and self.navigator is not None:
            self._publish(self.navigator.moved_to(cell))
        else:
            self._plan()

    def on_goal(self, message: PoseStamped) -> None:
        if self.info is None:
            self.get_logger().warning("goal ignored, no map yet")
            return
        self.goal = self._cell(message.pose.position.x, message.pose.position.y)
        self._plan()

    def on_scan(self, message: LaserScan) -> None:
        if self.navigator is None or self.pose is None or self.goal is None or self.position is None:
            return
        position = self.pose.pose.position
        orientation = self.pose.pose.orientation
        origin = self.info.origin.position
        cells = scan_cells(
            message.ranges,
            message.angle_min,
            message.angle_increment,
            message.range_min,
            message.range_max,
            position.x,
            position.y,
            yaw_from_quaternion(orientation.x, orientation.y, orientation.z, orientation.w),
            origin.x,
            origin.y,
            self.info.resolution,
        )
        self._publish(self.navigator.lidar_sweep(cells))

    def _plan(self) -> None:
        if self.navigator is not None and self.position is not None and self.goal is not None:
            self._publish(self.navigator.plan(self.position, self.goal))

    def _publish(self, result: Optional[PlanResult]) -> None:
        path = Path()
        path.header.frame_id = "map"
        path.header.stamp = self.get_clock().now().to_msg()
        if result is None:
            self.get_logger().warning("no route to the goal")
        else:
            origin = self.info.origin.position
            for cell in result.path:
                pose = PoseStamped()
                pose.header = path.header
                pose.pose.position.x, pose.pose.position.y = cell_to_world(cell, origin.x, origin.y, self.info.resolution)
                pose.pose.orientation.w = 1.0
                path.poses.append(pose)
        self.plan_publisher.publish(path)


def main() -> None:
    rclpy.init()
    node = NavigationNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.try_shutdown()


if __name__ == "__main__":
    main()
