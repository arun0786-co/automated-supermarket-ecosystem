import 'dart:convert';

import 'package:flutter/foundation.dart';

import 'auth_state.dart';
import 'json_body.dart';
import 'local_store.dart';

const _cacheKey = 'catalog.snapshot';

// the product catalog, cached on the device so it still works with poor reception (chapter 9.3)
class CatalogState extends ChangeNotifier {
  final AuthState auth;
  final LocalStore store;
  List<Map<String, dynamic>> products = [];
  bool fromCache = false;

  CatalogState({required this.auth, required this.store}) {
    _loadCache();
  }

  void _loadCache() {
    final cached = store.read(_cacheKey);
    if (cached == null) return;
    try {
      products = (jsonDecode(cached) as List).cast<Map<String, dynamic>>();
      fromCache = true;
    } on Object {
      store.remove(_cacheKey);
    }
  }

  Future<void> refresh() async {
    try {
      final res = await auth.get('/api/products');
      if (res.statusCode != 200) return;
      products = (jsonBody(res) as List).cast<Map<String, dynamic>>();
      fromCache = false;
      store.write(_cacheKey, jsonEncode(products));
      notifyListeners();
    } catch (_) {
      // offline or a bad response, the cached catalog stays on screen
    }
  }

  // chapter 4.3.2: price changes are pushed over the websocket
  void handleMessage(Map<String, dynamic> msg) {
    if (msg['type'] != 'PRICE_EVENT') return;
    final index = products.indexWhere((p) => p['sku'] == msg['sku']);
    if (index < 0) return;
    products[index] = {...products[index], 'price': msg['price'], 'discounted': msg['discounted']};
    store.write(_cacheKey, jsonEncode(products));
    notifyListeners();
  }
}
