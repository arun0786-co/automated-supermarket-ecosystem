// stage A: flutter run, talks straight to the simulator with no login. localhost works on the iOS
// simulator and desktop; on the android emulator add --dart-define=SIM_HOST=10.0.2.2:3001
//
// stage B: flutter run --dart-define=REQUIRE_LOGIN=true, goes through the gateway
const requireLogin = bool.fromEnvironment('REQUIRE_LOGIN');
const simHost = String.fromEnvironment('SIM_HOST', defaultValue: requireLogin ? 'localhost' : 'localhost:3001');
const simHttp = 'http://$simHost';
const simWs = requireLogin ? 'ws://$simHost/ws' : 'ws://$simHost';
