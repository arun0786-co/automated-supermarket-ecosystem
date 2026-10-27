import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import '../config.dart';

// CartState manages the live cart data for the mobile app.
// it connects to the same WebSocket as the web dashboard and
// listens for SCAN_EVENT messages that match the user's trolley.
class CartState extends ChangeNotifier {
  WebSocketChannel? _channel;
  bool connected = false;
  final List<Map<String, dynamic>> items = [];
  double total = 0.0;

  // trolley we're tracking (in stage B this comes from QR code scan at store entrance)
  final String trolleyId = 'TROLLEY-100';

  CartState() {
    _connect();
  }

  // set in dispose so a late onDone doesn't schedule another reconnect
  bool _disposed = false;

  Future<void> _connect() async {
    if (_disposed) return;
    try {
      final channel = WebSocketChannel.connect(Uri.parse(simWs));
      _channel = channel;
      // only report connected once the handshake has actually finished
      await channel.ready;
      if (_disposed) return;
      connected = true;
      notifyListeners();

      channel.stream.listen(
        (raw) {
          final msg = jsonDecode(raw as String) as Map<String, dynamic>;

          if (msg['type'] == 'SCAN_EVENT' && msg['trolleyId'] == trolleyId) {
            final event = msg['event'] as Map<String, dynamic>;
            if (event['accepted'] == true) {
              items.add(event);
              total = double.parse((total + (event['price'] as num).toDouble()).toStringAsFixed(2));
              notifyListeners();
            }
          }

          if (msg['type'] == 'CHECKOUT_EVENT' && msg['trolleyId'] == trolleyId) {
            // reset cart on checkout
            items.clear();
            total = 0.0;
            notifyListeners();
          }
        },
        onDone: _retry,
        // onDone follows the error, which handles the retry
        onError: (_) {},
      );
    } catch (_) {
      _retry();
    }
  }

  void _retry() {
    if (_disposed) return;
    connected = false;
    notifyListeners();
    Future.delayed(const Duration(seconds: 3), _connect);
  }

  @override
  void dispose() {
    _disposed = true;
    _channel?.sink.close();
    super.dispose();
  }
}
