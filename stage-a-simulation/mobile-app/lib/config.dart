// simulator address. localhost works on iOS simulator and desktop; on the android
// emulator use: flutter run --dart-define=SIM_HOST=10.0.2.2:3001
const simHost = String.fromEnvironment('SIM_HOST', defaultValue: 'localhost:3001');
const simHttp = 'http://$simHost';
const simWs = 'ws://$simHost';
