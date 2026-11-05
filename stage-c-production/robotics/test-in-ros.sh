#!/usr/bin/env bash
# builds the package and tests the running node over real topics in a ros 2 humble container, so
# ros doesn't need installing. this proves the node and its planning, not a robot: there is no
# gazebo, slam or hardware in it
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
docker run --rm -v "$HERE/ase_navigation:/src/ase_navigation:ro" ros:humble-ros-base bash -c '
  set -e
  source /opt/ros/humble/setup.bash
  mkdir -p /ws/src && cp -r /src/ase_navigation /ws/src/
  cd /ws
  colcon build --packages-select ase_navigation --event-handlers console_direct- > /tmp/build.log 2>&1 || { cat /tmp/build.log; exit 1; }
  echo "package built"
  source install/setup.bash
  ros2 run ase_navigation navigation_node --ros-args -p mode:=operating -p inflation_cells:=2 > /tmp/node.log 2>&1 &
  NODE=$!
  status=0
  python3 /ws/src/ase_navigation/test/ros_integration.py || status=$?
  kill -0 $NODE 2>/dev/null && echo "ok    the node is still running at the end" || { echo "FAIL  the node died"; status=1; }
  [ "$status" -eq 0 ] || tail -20 /tmp/node.log
  kill $NODE 2>/dev/null || true
  exit $status
'
