import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../config.dart';

// WalletState manages $SPMT balance for the logged-in user.
// polls the REST API every 5 seconds — in Stage B this becomes
// a WebSocket subscription to the checkout event stream.
class WalletState extends ChangeNotifier {
  double balance = 105.50;
  String userId  = 'USR-001';
  String name    = 'Arun K.';

  WalletState() {
    _fetchBalance();
  }

  Future<void> _fetchBalance() async {
    try {
      final res = await http.get(Uri.parse('$simHttp/api/wallets/$userId'));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        balance = (data['balance'] as num).toDouble();
        notifyListeners();
      }
    } catch (_) { /* offline — keep cached value */ }

    // poll every 5 seconds
    await Future.delayed(const Duration(seconds: 5));
    _fetchBalance();
  }
}
