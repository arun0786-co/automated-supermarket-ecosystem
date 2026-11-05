import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../config.dart';
import 'auth_state.dart';
import 'json_body.dart';
import 'local_store.dart';

const _cacheKey = 'wallet.snapshot';

// WalletState manages $SPMT balance for the logged-in user.
// polls the REST API every 5 seconds.
class WalletState extends ChangeNotifier {
  final AuthState? auth;
  final LocalStore? store;

  // stage A has no login, so it always shows this demo customer
  double balance = 0;
  String name = '';
  String _demoUser = '';
  double overdraftLimit = 0;
  bool isSubscriber = false;
  // the last known balance, because the server couldn't be reached
  bool stale = false;

  Timer? _poll;
  bool _disposed = false;

  WalletState({this.auth, this.store, bool poll = true}) {
    if (auth == null) {
      balance = 105.50;
      name = 'Arun K.';
      _demoUser = 'USR-001';
    }
    _loadCache();
    auth?.addListener(_onAuthChanged);
    if (poll) {
      refresh();
      _poll = Timer.periodic(const Duration(seconds: 5), (_) => refresh());
    }
  }

  String get userId => auth == null ? _demoUser : (auth!.userId ?? '');

  void _apply(Map<String, dynamic> data) {
    balance = (data['balance'] as num).toDouble();
    name = data['name'] as String;
    overdraftLimit = (data['overdraftLimit'] as num).toDouble();
    isSubscriber = data['isSubscriber'] as bool;
  }

  void _loadCache() {
    final cached = store?.read(_cacheKey);
    if (cached == null) return;
    try {
      _apply(jsonDecode(cached) as Map<String, dynamic>);
    } catch (_) {
      store?.remove(_cacheKey);
    }
  }

  void _onAuthChanged() {
    if (auth!.loggedIn) {
      refresh();
      return;
    }
    balance = 0;
    name = '';
    overdraftLimit = 0;
    isSubscriber = false;
    stale = false;
    store?.remove(_cacheKey);
    notifyListeners();
  }

  Future<void> refresh() async {
    if (auth != null && !auth!.loggedIn) return;
    try {
      final res = auth == null
          ? await http.get(Uri.parse('$simHttp/api/wallets/$userId'))
          : await auth!.get('/api/wallets/${Uri.encodeComponent(userId)}');
      if (res.statusCode == 200 && !_disposed) {
        final data = jsonBody(res) as Map<String, dynamic>;
        _apply(data);
        stale = false;
        store?.write(_cacheKey, jsonEncode(data));
        notifyListeners();
      }
    } catch (_) {
      // offline, keep the cached value and say it may be old
      if (!_disposed) {
        stale = true;
        notifyListeners();
      }
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _poll?.cancel();
    auth?.removeListener(_onAuthChanged);
    super.dispose();
  }
}
