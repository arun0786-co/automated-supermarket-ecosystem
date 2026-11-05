import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import '../config.dart';
import 'auth_state.dart';
import 'json_body.dart';
import 'local_store.dart';

const _cacheKey = 'cart.snapshot';
// the websocket closes with this when the token expires
const _tokenExpired = 4401;

// CartState manages the live cart data for the mobile app.
// it connects to the same WebSocket as the web dashboard and
// listens for SCAN_EVENT messages that match the user's trolley.
//
// items only ever enter a cart through a trolley, after vision and weight agree. so this app has
// no add-to-cart of its own to queue while offline (chapter 9.3): the broker holds scans during
// an outage, and the cart here catches up by reconciling with the server on reconnect
class CartState extends ChangeNotifier {
  final AuthState? auth;
  final LocalStore? store;
  final bool _autoConnect;
  WebSocketChannel? _channel;
  bool connected = false;
  final List<Map<String, dynamic>> items = [];
  List<Map<String, dynamic>> recommendations = [];
  double total = 0.0;

  // stage A follows a fixed trolley. in stage B it's whichever one this customer checked in to
  String? trolleyId;

  // set in dispose so a late onDone doesn't schedule another reconnect
  bool _disposed = false;
  final List<void Function(Map<String, dynamic>)> _messageListeners = [];

  // connect: false lets tests drive handleMessage without a simulator running
  CartState({bool connect = true, this.auth, this.store}) : _autoConnect = connect {
    if (auth == null) trolleyId = 'TROLLEY-100';
    _loadCache();
    auth?.addListener(_onAuthChanged);
    if (_autoConnect && (auth == null || auth!.loggedIn)) _connect();
  }

  // for other state that wants the feed, like prices in the catalog
  void addMessageListener(void Function(Map<String, dynamic>) listener) => _messageListeners.add(listener);

  void _loadCache() {
    final cached = store?.read(_cacheKey);
    if (cached == null) return;
    try {
      final data = jsonDecode(cached) as Map<String, dynamic>;
      items.addAll((data['items'] as List).cast<Map<String, dynamic>>());
      total = (data['total'] as num).toDouble();
      trolleyId = data['trolleyId'] as String?;
    } catch (_) {
      items.clear();
      total = 0;
      store?.remove(_cacheKey);
    }
  }

  void _saveCache() {
    store?.write(_cacheKey, jsonEncode({'trolleyId': trolleyId, 'items': items, 'total': total}));
  }

  void _onAuthChanged() {
    if (auth!.loggedIn) {
      if (_autoConnect && !connected && _channel == null) _connect();
      return;
    }
    // logged out: leave nothing for the next person on this phone
    final channel = _channel;
    _channel = null;
    channel?.sink.close();
    connected = false;
    items.clear();
    recommendations = [];
    total = 0;
    trolleyId = null;
    store?.remove(_cacheKey);
    notifyListeners();
  }

  bool _isMine(Map<String, dynamic> msg) {
    if (auth == null) return msg['trolleyId'] == trolleyId;
    return msg['userId'] == auth!.userId && (trolleyId == null || msg['trolleyId'] == trolleyId);
  }

  void handleRaw(dynamic raw) {
    final Object? decoded;
    try {
      decoded = jsonDecode(raw as String);
    } catch (_) {
      return;
    }
    if (decoded is! Map<String, dynamic>) return;
    handleMessage(decoded);
    for (final listener in _messageListeners) {
      listener(decoded);
    }
  }

  @visibleForTesting
  void handleMessage(Map<String, dynamic> msg) {
    if (msg['type'] == 'SCAN_EVENT' && _isMine(msg)) {
      final event = msg['event'];
      if (event is Map<String, dynamic> && event['accepted'] == true && event['price'] is num) {
        // a scan can reach us twice: over the feed and in a reconcile
        final seen = event['ts'] != null && items.any((i) => i['sku'] == event['sku'] && i['ts'] == event['ts']);
        if (!seen) {
          trolleyId ??= msg['trolleyId'] as String?;
          items.add(event);
          total = double.parse((total + (event['price'] as num).toDouble()).toStringAsFixed(2));
          _saveCache();
          notifyListeners();
        }
      }
    }

    if (msg['type'] == 'RECOMMENDATION_EVENT' && _isMine(msg) && msg['recs'] is List) {
      recommendations = (msg['recs'] as List).cast<Map<String, dynamic>>();
      notifyListeners();
    }

    if (msg['type'] == 'CHECKOUT_EVENT' && _isMine(msg)) {
      // reset cart on checkout
      items.clear();
      recommendations = [];
      total = 0.0;
      _saveCache();
      notifyListeners();
    }
  }

  // state reconciliation (chapter 9.3): anything missed while offline, including a checkout, is
  // settled by taking the server's cart as the truth
  Future<void> reconcile() async {
    final session = auth;
    if (session == null || session.userId == null) return;
    try {
      final res = await session.get('/api/fleet/cart/${Uri.encodeComponent(session.userId!)}');
      if (res.statusCode != 200) return;
      final data = jsonBody(res) as Map<String, dynamic>;
      final serverItems = (data['items'] as List).cast<Map<String, dynamic>>();
      items
        ..clear()
        ..addAll(serverItems);
      total = (data['total'] as num).toDouble();
      trolleyId = (data['trolleyId'] as String?) ?? trolleyId;
      _saveCache();
      notifyListeners();
    } catch (_) {
      // still offline, what's on screen is the best we have
    }
  }

  Future<void> _connect() async {
    if (_disposed) return;
    try {
      final session = auth;
      final token = session == null ? null : await session.token();
      if (_disposed || (session != null && !session.loggedIn)) return;
      if (session != null && token == null) {
        _retry();
        return;
      }
      final url = token == null ? simWs : '$simWs?token=${Uri.encodeQueryComponent(token)}';
      final channel = WebSocketChannel.connect(Uri.parse(url));
      _channel = channel;
      // only report connected once the handshake has actually finished
      await channel.ready;
      if (_disposed || !identical(channel, _channel)) return;
      connected = true;
      notifyListeners();

      channel.stream.listen(
        handleRaw,
        onDone: () {
          if (identical(channel, _channel)) _retry(immediately: channel.closeCode == _tokenExpired);
        },
        // onDone follows the error, which handles the retry
        onError: (_) {},
      );
      await reconcile();
    } catch (_) {
      _retry();
    }
  }

  void _retry({bool immediately = false}) {
    if (_disposed) return;
    connected = false;
    notifyListeners();
    // an expired token reconnects straight away with a fresh one
    Future.delayed(immediately ? Duration.zero : const Duration(seconds: 3), _connect);
  }

  @override
  void dispose() {
    _disposed = true;
    auth?.removeListener(_onAuthChanged);
    _channel?.sink.close();
    super.dispose();
  }
}
