import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../config.dart';
import 'json_body.dart';
import 'local_store.dart';

class AuthError implements Exception {
  final String message;
  AuthError(this.message);

  @override
  String toString() => message;
}

const _refreshKey = 'auth.refreshToken';
const _userKey = 'auth.user';
const _requestTimeout = Duration(seconds: 10);
// refresh a little early, so a token doesn't expire on its way to the server
const _expiryMargin = Duration(seconds: 30);

// the logged in session against the stage B gateway
class AuthState extends ChangeNotifier {
  final LocalStore store;
  final http.Client _client;
  final String base;
  final DateTime Function() _now;

  String? userId;
  String? name;
  String? role;
  String? _accessToken;
  DateTime _expiresAt = DateTime.fromMillisecondsSinceEpoch(0);
  // a refresh token works once and reuse revokes the session, so concurrent callers share one
  Future<String?>? _refreshing;

  AuthState({required this.store, http.Client? client, String? base, DateTime Function()? now})
      : _client = client ?? http.Client(),
        base = base ?? simHttp,
        _now = now ?? DateTime.now;

  bool get loggedIn => userId != null;

  void _adopt(Map<String, dynamic> tokens) {
    final user = tokens['user'] as Map<String, dynamic>;
    userId = user['id'] as String;
    name = user['name'] as String;
    role = user['role'] as String;
    _accessToken = tokens['accessToken'] as String;
    _expiresAt = _now().add(Duration(seconds: tokens['expiresIn'] as int));
    // the access token stays in memory. only what a restart needs is stored
    store.write(_refreshKey, tokens['refreshToken'] as String);
    store.write(_userKey, jsonEncode(user));
  }

  void _clear() {
    userId = null;
    name = null;
    role = null;
    _accessToken = null;
    _expiresAt = DateTime.fromMillisecondsSinceEpoch(0);
    store.remove(_refreshKey);
    store.remove(_userKey);
  }

  Future<http.Response> _postJson(String path, Object body) => _client
      .post(Uri.parse('$base$path'), headers: {'content-type': 'application/json'}, body: jsonEncode(body))
      .timeout(_requestTimeout);

  Future<void> login(String email, String password) async {
    final http.Response res;
    try {
      res = await _postJson('/api/auth/login', {'email': email, 'password': password});
    } on Exception {
      throw AuthError('Could not reach the store network');
    }
    if (res.statusCode == 429) throw AuthError('Too many attempts, wait a minute and try again');
    if (res.statusCode != 200) throw AuthError('Invalid email or password');
    _adopt(jsonBody(res) as Map<String, dynamic>);
    notifyListeners();
  }

  // at app start. true if there is someone to show the app to. no network still counts: a
  // shopper with poor reception shouldn't hit a login wall (chapter 9.3)
  Future<bool> restore() async {
    final stored = store.read(_userKey);
    if (stored == null || store.read(_refreshKey) == null) return false;
    try {
      final user = jsonDecode(stored) as Map<String, dynamic>;
      userId = user['id'] as String;
      name = user['name'] as String;
      role = user['role'] as String;
    } on Object {
      _clear();
      return false;
    }
    await _refresh();
    return loggedIn;
  }

  Future<String?> token() async {
    if (_accessToken != null && _now().isBefore(_expiresAt.subtract(_expiryMargin))) return _accessToken;
    return _refresh();
  }

  Future<String?> _refresh() {
    return _refreshing ??= _runRefresh().whenComplete(() => _refreshing = null);
  }

  Future<String?> _runRefresh() async {
    final refreshToken = store.read(_refreshKey);
    if (refreshToken == null) return null;
    final http.Response res;
    try {
      res = await _postJson('/api/auth/refresh', {'refreshToken': refreshToken});
    } on Exception {
      // a network blip isn't a logout. try again on the next call
      return null;
    }
    if (res.statusCode != 200) {
      _clear();
      notifyListeners();
      return null;
    }
    _adopt(jsonBody(res) as Map<String, dynamic>);
    return _accessToken;
  }

  Future<http.Response> get(String path) async {
    Future<http.Response> send(String? token) => _client
        .get(Uri.parse('$base$path'), headers: {if (token != null) 'authorization': 'Bearer $token'})
        .timeout(_requestTimeout);

    final res = await send(await token());
    if (res.statusCode != 401) return res;

    // the server has stopped accepting this token, even if it hasn't timed out here
    _accessToken = null;
    final fresh = await _refresh();
    if (fresh == null) return res;
    return send(fresh);
  }

  Future<void> logout() async {
    final refreshToken = store.read(_refreshKey);
    _clear();
    notifyListeners();
    if (refreshToken != null) {
      await _postJson('/api/auth/logout', {'refreshToken': refreshToken}).then<void>((_) {}, onError: (_) {});
    }
  }

  // chapter 10.3, right to be forgotten
  Future<void> forget(String password) async {
    final token = await this.token();
    final http.Response res;
    try {
      res = await _client
          .delete(
            Uri.parse('$base/api/auth/me'),
            headers: {'content-type': 'application/json', if (token != null) 'authorization': 'Bearer $token'},
            body: jsonEncode({'password': password}),
          )
          .timeout(_requestTimeout);
    } on Exception {
      throw AuthError('Could not reach the store network');
    }
    if (res.statusCode != 204) throw AuthError('Wrong password');
    _clear();
    notifyListeners();
  }
}
