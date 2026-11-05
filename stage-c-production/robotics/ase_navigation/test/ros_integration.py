"""drives the running node over real ros topics. needs a ros 2 environment, see test-in-ros.sh."""
import math
import sys
import time

import rclpy
from geometry_msgs.msg import PoseStamped
from nav_msgs.msg import OccupancyGrid, Path
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile
from sensor_msgs.msg import LaserScan

SIZE = 30
RESOLUTION = 0.5
failures = 0


def check(label, condition, detail=""):
    global failures
    print(f"{'ok   ' if condition else 'FAIL '} {label} {detail if not condition else ''}", flush=True)
    failures += 0 if condition else 1


class Tester(Node):
    def __init__(self):
        super().__init__("tester")
        latched = QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL)
        self.map_pub = self.create_publisher(OccupancyGrid, "map", latched)
        self.pose_pub = self.create_publisher(PoseStamped, "pose", 10)
        self.goal_pub = self.create_publisher(PoseStamped, "goal_pose", 10)
        self.scan_pub = self.create_publisher(LaserScan, "scan", 10)
        self.plans = []
        self.create_subscription(Path, "plan", self.plans.append, latched)

    def pose(self, x, y):
        message = PoseStamped()
        message.header.frame_id = "map"
        message.pose.position.x = float(x)
        message.pose.position.y = float(y)
        message.pose.orientation.w = 1.0
        return message

    def wait_for_plan(self, after, seconds=20):
        deadline = time.time() + seconds
        while time.time() < deadline:
            rclpy.spin_once(self, timeout_sec=0.1)
            if len(self.plans) > after:
                return self.plans[-1]
        return None


def cells(path):
    return [(math.floor(p.pose.position.x / RESOLUTION), math.floor(p.pose.position.y / RESOLUTION)) for p in path.poses]


rclpy.init()
tester = Tester()

deadline = time.time() + 30
while time.time() < deadline and tester.count_subscribers("goal_pose") == 0:
    rclpy.spin_once(tester, timeout_sec=0.2)
check("the node is up and listening", tester.count_subscribers("goal_pose") > 0)

# a wall down the middle with a gap at the top
grid = OccupancyGrid()
grid.header.frame_id = "map"
grid.info.resolution = RESOLUTION
grid.info.width = SIZE
grid.info.height = SIZE
data = [0] * (SIZE * SIZE)
wall_x = 15
for y in range(0, 22):
    data[y * SIZE + wall_x] = 100
grid.data = data
tester.map_pub.publish(grid)
time.sleep(1)

start = (2.25, 2.25)  # cell (4, 4)
goal = (12.25, 2.25)  # cell (24, 4), other side of the wall
tester.pose_pub.publish(tester.pose(*start))
for _ in range(10):
    rclpy.spin_once(tester, timeout_sec=0.05)
seen = len(tester.plans)
tester.goal_pub.publish(tester.pose(*goal))
plan = tester.wait_for_plan(seen)
check("a goal produces a route", plan is not None and len(plan.poses) > 0)
route = cells(plan)
check("it starts at the trolley", route[0] == (4, 4), str(route[0]))
check("it ends at the goal", route[-1] == (24, 4), str(route[-1]))
check("it goes around the wall through the gap", all(not (x == wall_x and y < 22) for x, y in route) and max(y for _, y in route) >= 22)
check("it stays clear of the wall's safety buffer", all(not (abs(x - wall_x) <= 2 and y < 22) for x, y in route))
check("the path is in the map frame", plan.header.frame_id == "map")

# a shopper steps onto the route: the lidar sees something straight ahead along +y, on the route
ahead = next(c for c in route if c[1] >= 12)
distance = math.hypot((ahead[0] + 0.5) * RESOLUTION - start[0], (ahead[1] + 0.5) * RESOLUTION - start[1])
bearing = math.atan2((ahead[1] + 0.5) * RESOLUTION - start[1], (ahead[0] + 0.5) * RESOLUTION - start[0])
scan = LaserScan()
scan.header.frame_id = "base_link"
scan.angle_min = bearing
scan.angle_max = bearing
scan.angle_increment = 0.01
scan.range_min = 0.1
scan.range_max = 30.0
scan.ranges = [float(distance)]
seen = len(tester.plans)
tester.scan_pub.publish(scan)
detour = tester.wait_for_plan(seen)
check("the lidar seeing someone triggers a new route", detour is not None and len(detour.poses) > 0)
new_route = cells(detour)
check("it avoids where they are standing", ahead not in new_route, str(ahead))
check("and still reaches the goal", new_route[-1] == (24, 4))

# they walk away: an empty sweep
seen = len(tester.plans)
scan.ranges = [float("inf")]
tester.scan_pub.publish(scan)
back = tester.wait_for_plan(seen)
check("when they leave the short route comes back", back is not None and len(cells(back)) <= len(route))

# the trolley moves along the route
seen = len(tester.plans)
step = route[3]
tester.pose_pub.publish(tester.pose((step[0] + 0.5) * RESOLUTION, (step[1] + 0.5) * RESOLUTION))
moved = tester.wait_for_plan(seen)
check("moving replans from the new position", moved is not None and cells(moved)[0] == step)

# a goal behind a sealed wall
seen = len(tester.plans)
blocked = OccupancyGrid()
blocked.header.frame_id = "map"
blocked.info = grid.info
sealed = [0] * (SIZE * SIZE)
for y in range(SIZE):
    sealed[y * SIZE + wall_x] = 100
blocked.data = sealed
tester.map_pub.publish(blocked)
empty = tester.wait_for_plan(seen)
check("no possible route publishes an empty plan, and the node stays up", empty is not None and len(empty.poses) == 0)

tester.destroy_node()
rclpy.shutdown()
print(f"\n{failures} failed", flush=True)
sys.exit(1 if failures else 0)
