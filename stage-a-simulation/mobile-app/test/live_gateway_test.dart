// the app's real state classes against a real running stage B, over real http and websockets.
// skipped unless pointed at a stack, stage-b-mvp/e2e/run.sh does that:
//   flutter test test/live_gateway_test.dart --dart-define=REQUIRE_LOGIN=true \
//     --dart-define=SIM_HOST=localhost --dart-define=DEMO_PASSWORD=...

import 'package:ase_mobile/state/auth_state.dart';
import 'package:ase_mobile/state/cart_state.dart';
import 'package:ase_mobile/state/catalog_state.dart';
import 'package:ase_mobile/state/local_store.dart';
import 'package:ase_mobile/state/wallet_state.dart';
import 'package:flutter_test/flutter_test.dart';

const password = String.fromEnvironment('DEMO_PASSWORD');

Future<void> eventually(bool Function() condition, String what, {int seconds = 60}) async {
  final deadline = DateTime.now().add(Duration(seconds: seconds));
  while (!condition()) {
    if (DateTime.now().isAfter(deadline)) fail('timed out waiting for $what');
    await Future<void>.delayed(const Duration(milliseconds: 200));
  }
}

void main() {
  test('a customer uses the app against the real gateway', skip: password.isEmpty ? 'needs a running stack' : false, () async {
    final store = MemoryStore();
    final auth = AuthState(store: store);

    await expectLater(auth.login('arun@ase.local', 'wrong password'), throwsA(isA<AuthError>()));
    expect(auth.loggedIn, isFalse);

    await auth.login('arun@ase.local', password);
    expect(auth.userId, 'USR-001');

    final catalog = CatalogState(auth: auth, store: store);
    await catalog.refresh();
    expect(catalog.products.length, 33);
    expect(catalog.products.first['emoji'], isNotEmpty);
    expect(catalog.fromCache, isFalse);

    final wallet = WalletState(auth: auth, store: store, poll: false);
    await wallet.refresh();
    expect(wallet.name, 'Arun K.');
    expect(wallet.stale, isFalse);

    final cart = CartState(auth: auth, store: store);
    await eventually(() => cart.connected, 'the live feed to connect');
    await eventually(() => cart.trolleyId != null, 'a trolley');
    await eventually(() => cart.items.isNotEmpty, 'an item to be scanned');
    await eventually(() => cart.recommendations.isNotEmpty, 'recommendations');
    expect(cart.recommendations.first['name'], isA<String>());

    // state reconciliation: the server's cart replaces ours, and its total has to add up
    await cart.reconcile();
    final sum = cart.items.fold<double>(0, (total, item) => total + (item['price'] as num).toDouble());
    expect(cart.total, closeTo(sum, 0.01));
    expect(cart.trolleyId, isNotNull);

    await auth.logout();
    await eventually(() => !cart.connected, 'the feed to close');
    expect(cart.items, isEmpty);
    expect(store.values.containsKey('cart.snapshot'), isFalse);

    cart.dispose();
    wallet.dispose();
  }, timeout: const Timeout(Duration(minutes: 3)));
}
