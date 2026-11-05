import 'dart:convert';

import 'package:ase_mobile/state/auth_state.dart';
import 'package:ase_mobile/state/cart_state.dart';
import 'package:ase_mobile/state/catalog_state.dart';
import 'package:ase_mobile/state/local_store.dart';
import 'package:ase_mobile/state/wallet_state.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

// real servers send utf-8 bytes, and not always a charset
http.Response json(Object body, [int status = 200]) => http.Response.bytes(utf8.encode(jsonEncode(body)), status);

final session = {
  'accessToken': 'a',
  'refreshToken': 'r',
  'expiresIn': 900,
  'user': {'id': 'USR-001', 'name': 'Arun K.', 'role': 'customer'},
};

Map<String, dynamic> item(String sku, {num price = 2.5, String ts = '2026-11-06T10:00:00Z'}) => {
      'sku': sku,
      'name': 'Item $sku',
      'emoji': '🛒',
      'confidence': 0.9,
      'weightDelta': 100,
      'price': price,
      'discounted': false,
      'ts': ts,
    };

Map<String, dynamic> scan(String trolley, String user, Map<String, dynamic> event) => {
      'type': 'SCAN_EVENT',
      'trolleyId': trolley,
      'userId': user,
      'event': {...event, 'accepted': true},
    };

/// answers the way the gateway does, until it is switched off
class FakeServer {
  bool online = true;
  Map<String, dynamic> cart = {'trolleyId': null, 'status': 'IDLE', 'items': [], 'total': 0};
  List<Map<String, dynamic>> products = [
    {'sku': 'PRD-001', 'name': 'Banana', 'emoji': '🍌', 'category': 'Produce', 'price': 1.2, 'discounted': false, 'stockLevel': 80},
    {'sku': 'BKR-003', 'name': 'Croissant', 'emoji': '🥐', 'category': 'Bakery', 'price': 2.4, 'discounted': true, 'stockLevel': 40},
  ];
  Map<String, dynamic> wallet = {'userId': 'USR-001', 'name': 'Arun K.', 'balance': 42.5, 'overdraftLimit': -20, 'isSubscriber': true};

  late final MockClient client = MockClient((req) async {
    if (req.url.path.endsWith('/login')) return json(session);
    if (!online) throw http.ClientException('no route');
    if (req.url.path.endsWith('/refresh')) return json(session);
    if (req.url.path == '/api/fleet/cart/USR-001') return json(cart);
    if (req.url.path == '/api/products') return json(products);
    if (req.url.path == '/api/wallets/USR-001') return json(wallet);
    return json({'error': 'not found'}, 404);
  });
}

Future<AuthState> signedIn(FakeServer server, MemoryStore store) async {
  final auth = AuthState(store: store, client: server.client, base: 'http://gw');
  await auth.login('a@b.c', 'pw');
  return auth;
}

void main() {
  group('cart', () {
    test('follows the signed-in customer, whichever trolley that is', () async {
      final server = FakeServer();
      final cart = CartState(connect: false, auth: await signedIn(server, MemoryStore()), store: MemoryStore());
      cart.handleMessage(scan('TROLLEY-777', 'USR-001', item('A')));
      expect(cart.trolleyId, 'TROLLEY-777');
      expect(cart.items.length, 1);
    });

    test('ignores other customers', () async {
      final server = FakeServer();
      final cart = CartState(connect: false, auth: await signedIn(server, MemoryStore()), store: MemoryStore());
      cart.handleMessage(scan('TROLLEY-101', 'USR-002', item('A')));
      expect(cart.items, isEmpty);
      expect(cart.trolleyId, isNull);
    });

    test('sticks to one trolley once it has one', () async {
      final server = FakeServer();
      final cart = CartState(connect: false, auth: await signedIn(server, MemoryStore()), store: MemoryStore());
      cart.handleMessage(scan('TROLLEY-100', 'USR-001', item('A')));
      cart.handleMessage(scan('TROLLEY-103', 'USR-001', item('B')));
      expect(cart.items.length, 1);
    });

    test('checkout of that trolley clears the cart', () async {
      final server = FakeServer();
      final cart = CartState(connect: false, auth: await signedIn(server, MemoryStore()), store: MemoryStore());
      cart.handleMessage(scan('TROLLEY-100', 'USR-001', item('A')));
      cart.handleMessage({'type': 'CHECKOUT_EVENT', 'trolleyId': 'TROLLEY-100', 'userId': 'USR-001', 'ok': true});
      expect(cart.items, isEmpty);
      expect(cart.total, 0);
    });

    test('reconciling takes the server as the truth', () async {
      final server = FakeServer();
      final cart = CartState(connect: false, auth: await signedIn(server, MemoryStore()), store: MemoryStore());
      cart.handleMessage(scan('TROLLEY-100', 'USR-001', item('STALE')));

      server.cart = {
        'trolleyId': 'TROLLEY-100',
        'status': 'SHOPPING',
        'items': [item('A', price: 1.5), item('B', price: 2)],
        'total': 3.5,
      };
      await cart.reconcile();
      expect(cart.items.map((i) => i['sku']), ['A', 'B']);
      expect(cart.total, 3.5);
    });

    test('reconciling empty clears what was scanned before a checkout we missed', () async {
      final server = FakeServer();
      final cart = CartState(connect: false, auth: await signedIn(server, MemoryStore()), store: MemoryStore());
      cart.handleMessage(scan('TROLLEY-100', 'USR-001', item('A')));
      server.cart = {'trolleyId': 'TROLLEY-100', 'status': 'SHOPPING', 'items': [], 'total': 0};
      await cart.reconcile();
      expect(cart.items, isEmpty);
    });

    test('an event that also arrives in the reconcile counts once', () async {
      final server = FakeServer();
      final cart = CartState(connect: false, auth: await signedIn(server, MemoryStore()), store: MemoryStore());
      server.cart = {
        'trolleyId': 'TROLLEY-100',
        'status': 'SHOPPING',
        'items': [item('A', price: 1.5)],
        'total': 1.5,
      };
      await cart.reconcile();
      cart.handleMessage(scan('TROLLEY-100', 'USR-001', item('A', price: 1.5)));
      expect(cart.items.length, 1);
      expect(cart.total, 1.5);
    });

    test('a failed reconcile keeps what is on screen', () async {
      final server = FakeServer();
      final cart = CartState(connect: false, auth: await signedIn(server, MemoryStore()), store: MemoryStore());
      cart.handleMessage(scan('TROLLEY-100', 'USR-001', item('A')));
      server.online = false;
      await cart.reconcile();
      expect(cart.items.length, 1);
    });

    test('the last known cart loads with no network', () async {
      final server = FakeServer();
      final store = MemoryStore();
      final auth = await signedIn(server, store);
      final first = CartState(connect: false, auth: auth, store: store);
      first.handleMessage(scan('TROLLEY-100', 'USR-001', item('A', price: 3)));

      server.online = false;
      final reopened = CartState(connect: false, auth: auth, store: store);
      expect(reopened.items.length, 1);
      expect(reopened.total, 3);
      expect(reopened.trolleyId, 'TROLLEY-100');
    });

    test('a damaged cache starts empty instead of crashing', () async {
      final server = FakeServer();
      final store = MemoryStore()..values['cart.snapshot'] = '{broken';
      final cart = CartState(connect: false, auth: await signedIn(server, store), store: store);
      expect(cart.items, isEmpty);
    });

    test('logging out leaves nothing for the next person on this phone', () async {
      final server = FakeServer();
      final store = MemoryStore();
      final auth = await signedIn(server, store);
      final cart = CartState(connect: false, auth: auth, store: store);
      cart.handleMessage(scan('TROLLEY-100', 'USR-001', item('A')));
      await auth.logout();
      expect(cart.items, isEmpty);
      expect(store.values.containsKey('cart.snapshot'), isFalse);
    });

    test('malformed feed messages are ignored', () async {
      final server = FakeServer();
      final cart = CartState(connect: false, auth: await signedIn(server, MemoryStore()), store: MemoryStore());
      cart.handleRaw('{nope');
      cart.handleRaw('[1,2]');
      cart.handleMessage({'type': 'SCAN_EVENT', 'trolleyId': 'T', 'userId': 'USR-001'});
      cart.handleMessage({'type': 'SCAN_EVENT', 'trolleyId': 'T', 'userId': 'USR-001', 'event': 'oops'});
      expect(cart.items, isEmpty);
    });

    test('recommendations for this customer are kept, then cleared at checkout', () async {
      final server = FakeServer();
      final cart = CartState(connect: false, auth: await signedIn(server, MemoryStore()), store: MemoryStore());
      cart.handleMessage(scan('TROLLEY-100', 'USR-001', item('A')));
      cart.handleMessage({
        'type': 'RECOMMENDATION_EVENT',
        'trolleyId': 'TROLLEY-100',
        'userId': 'USR-001',
        'recs': [
          {'sku': 'B', 'name': 'Bread', 'emoji': '🍞', 'reason': 'goes well', 'price': 2},
        ],
      });
      expect(cart.recommendations.single['name'], 'Bread');
      cart.handleMessage({'type': 'RECOMMENDATION_EVENT', 'trolleyId': 'T9', 'userId': 'USR-002', 'recs': []});
      expect(cart.recommendations.length, 1);
      cart.handleMessage({'type': 'CHECKOUT_EVENT', 'trolleyId': 'TROLLEY-100', 'userId': 'USR-001', 'ok': true});
      expect(cart.recommendations, isEmpty);
    });
  });

  group('catalog', () {
    test('loads from the server and caches it', () async {
      final server = FakeServer();
      final store = MemoryStore();
      final catalog = CatalogState(auth: await signedIn(server, store), store: store);
      await catalog.refresh();
      expect(catalog.products.length, 2);
      expect(catalog.fromCache, isFalse);
    });

    test('works from the cache with no network', () async {
      final server = FakeServer();
      final store = MemoryStore();
      final auth = await signedIn(server, store);
      await CatalogState(auth: auth, store: store).refresh();

      server.online = false;
      final offline = CatalogState(auth: auth, store: store);
      await offline.refresh();
      expect(offline.products.length, 2);
      expect(offline.fromCache, isTrue);
    });

    test('no network and no cache is empty, not a crash', () async {
      final server = FakeServer();
      final store = MemoryStore();
      final auth = await signedIn(server, store);
      server.online = false;
      final catalog = CatalogState(auth: auth, store: store);
      await catalog.refresh();
      expect(catalog.products, isEmpty);
    });

    // chapter 4.3.2: price changes get pushed to the app
    test('a pushed price change shows up and is cached', () async {
      final server = FakeServer();
      final store = MemoryStore();
      final auth = await signedIn(server, store);
      final catalog = CatalogState(auth: auth, store: store);
      await catalog.refresh();
      catalog.handleMessage({'type': 'PRICE_EVENT', 'sku': 'BKR-003', 'price': 3, 'discounted': false});
      final croissant = catalog.products.firstWhere((p) => p['sku'] == 'BKR-003');
      expect(croissant['price'], 3);
      expect(croissant['discounted'], false);

      server.online = false;
      final offline = CatalogState(auth: auth, store: store);
      await offline.refresh();
      expect(offline.products.firstWhere((p) => p['sku'] == 'BKR-003')['price'], 3);
    });

    test('emoji survive a response with no charset', () async {
      final server = FakeServer();
      final store = MemoryStore();
      final catalog = CatalogState(auth: await signedIn(server, store), store: store);
      await catalog.refresh();
      expect(catalog.products.first['emoji'], '🍌');
    });

    test('a price for an unknown sku is ignored', () async {
      final server = FakeServer();
      final store = MemoryStore();
      final catalog = CatalogState(auth: await signedIn(server, store), store: store);
      await catalog.refresh();
      catalog.handleMessage({'type': 'PRICE_EVENT', 'sku': 'NOPE', 'price': 3, 'discounted': false});
      expect(catalog.products.length, 2);
    });
  });

  group('wallet', () {
    test('shows the signed-in customer, not a made up default', () async {
      final server = FakeServer();
      final store = MemoryStore();
      final wallet = WalletState(auth: await signedIn(server, store), store: store, poll: false);
      await wallet.refresh();
      expect(wallet.userId, 'USR-001');
      expect(wallet.balance, 42.5);
      expect(wallet.isSubscriber, isTrue);
      wallet.dispose();
    });

    test('keeps the last known balance offline, and says it is old', () async {
      final server = FakeServer();
      final store = MemoryStore();
      final auth = await signedIn(server, store);
      final first = WalletState(auth: auth, store: store, poll: false);
      await first.refresh();
      first.dispose();

      server.online = false;
      final offline = WalletState(auth: auth, store: store, poll: false);
      await offline.refresh();
      expect(offline.balance, 42.5);
      expect(offline.stale, isTrue);
      offline.dispose();
    });
  });
}
