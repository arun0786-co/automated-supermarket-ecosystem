import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../config.dart';

// WalletState manages $SPMT balance for the logged-in user.
// polls the REST API every 5 seconds. in Stage B this becomes
// a WebSocket subscription to the checkout event stream.
class WalletState extends ChangeNotifier {
  double balance = 105.50;
  String userId  = 'USR-001';
  String name    = 'Arun K.';

  Timer? _poll;
  bool _disposed = false;

  WalletState() {
    _fetchBalance();
    _poll = Timer.periodic(const Duration(seconds: 5), (_) => _fetchBalance());
  }

  Future<void> _fetchBalance() async {
    try {
      final res = await http.get(Uri.parse('$simHttp/api/wallets/$userId'));
      if (res.statusCode == 200 && !_disposed) {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        balance = (data['balance'] as num).toDouble();
        notifyListeners();
      }
    } catch (_) { /* offline, keep cached value */ }
  }

  @override
  void dispose() {
    _disposed = true;
    _poll?.cancel();
    super.dispose();
  }
}
