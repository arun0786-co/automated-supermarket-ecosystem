import 'package:shared_preferences/shared_preferences.dart';

// the app's on-device cache (chapter 9.3). a key-value store is enough: a catalog of this size is
// read whole, never queried. a production build should keep the refresh token in the platform
// keychain instead of here
abstract class LocalStore {
  String? read(String key);
  void write(String key, String value);
  void remove(String key);
}

class PrefsStore implements LocalStore {
  final SharedPreferences _prefs;
  PrefsStore(this._prefs);

  static Future<PrefsStore> open() async => PrefsStore(await SharedPreferences.getInstance());

  @override
  String? read(String key) => _prefs.getString(key);

  // fire and forget: the value is already readable, and a lost write only costs a refetch
  @override
  void write(String key, String value) => _prefs.setString(key, value);

  @override
  void remove(String key) => _prefs.remove(key);
}

class MemoryStore implements LocalStore {
  final Map<String, String> values = {};

  @override
  String? read(String key) => values[key];

  @override
  void write(String key, String value) => values[key] = value;

  @override
  void remove(String key) => values.remove(key);
}
