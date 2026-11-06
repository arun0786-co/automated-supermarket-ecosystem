import 'dart:convert';

import 'package:ase_mobile/main.dart';
import 'package:ase_mobile/screens/catalog_screen.dart';
import 'package:ase_mobile/screens/home_screen.dart';
import 'package:ase_mobile/state/auth_state.dart';
import 'package:ase_mobile/state/cart_state.dart';
import 'package:ase_mobile/state/catalog_state.dart';
import 'package:ase_mobile/state/local_store.dart';
import 'package:ase_mobile/state/wallet_state.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';

const tokens = {
  'accessToken': 'a',
  'refreshToken': 'r',
  'expiresIn': 900,
  'user': {'id': 'USR-001', 'name': 'Arun K.', 'role': 'customer'},
};

AuthState authWith(int loginStatus) => AuthState(
      store: MemoryStore(),
      base: 'http://gw',
      client: MockClient((req) async {
        if (req.url.path.endsWith('/login')) return http.Response(jsonEncode(tokens), loginStatus);
        if (req.url.path.contains('/api/wallets/')) {
          return http.Response(jsonEncode({'userId': 'USR-001', 'name': 'Arun K.', 'balance': 7.5, 'overdraftLimit': 0, 'isSubscriber': false}), 200);
        }
        return http.Response('{}', 404);
      }),
    );

Widget app(AuthState auth) {
  final store = MemoryStore();
  return MultiProvider(
    providers: [
      ListenableProvider<AuthState?>.value(value: auth),
      ChangeNotifierProvider(create: (_) => CartState(connect: false, auth: auth, store: store)),
      ChangeNotifierProvider(create: (_) => WalletState(auth: auth, store: store, poll: false)),
      ChangeNotifierProvider(create: (_) => CatalogState(auth: auth, store: store)),
    ],
    child: AseApp(auth: auth),
  );
}

void main() {
  testWidgets('with no session the app opens on the login screen', (tester) async {
    await tester.pumpWidget(app(authWith(200)));
    await tester.pumpAndSettle();
    expect(find.text('Log in'), findsOneWidget);
    expect(find.text('Your Cart'), findsNothing);
  });

  testWidgets('a wrong password shows why and stays there', (tester) async {
    await tester.pumpWidget(app(authWith(401)));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('email')), 'a@b.c');
    await tester.enterText(find.byKey(const Key('password')), 'nope');
    await tester.tap(find.text('Log in'));
    await tester.pumpAndSettle();
    expect(find.text('Invalid email or password'), findsOneWidget);
    expect(find.text('Your Cart'), findsNothing);
  });

  testWidgets('logging in opens the app, logging out returns to login', (tester) async {
    final auth = authWith(200);
    await tester.pumpWidget(app(auth));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('email')), 'a@b.c');
    await tester.enterText(find.byKey(const Key('password')), 'pw');
    await tester.tap(find.text('Log in'));
    await tester.pumpAndSettle();
    expect(find.text('Your Cart'), findsOneWidget);

    await auth.logout();
    await tester.pumpAndSettle();
    expect(find.text('Log in'), findsOneWidget);
  });

  testWidgets('home shows recommendations and an honest offline message', (tester) async {
    final auth = authWith(200);
    await auth.login('a@b.c', 'pw');
    final store = MemoryStore();
    final cart = CartState(connect: false, auth: auth, store: store);
    final wallet = WalletState(auth: auth, store: store, poll: false);
    cart.handleMessage({
      'type': 'SCAN_EVENT',
      'trolleyId': 'TROLLEY-100',
      'userId': 'USR-001',
      'event': {'sku': 'A', 'name': 'Banana', 'emoji': '🍌', 'confidence': 0.9, 'weightDelta': 150, 'price': 1.2, 'accepted': true},
    });
    cart.handleMessage({
      'type': 'RECOMMENDATION_EVENT',
      'trolleyId': 'TROLLEY-100',
      'userId': 'USR-001',
      'recs': [
        {'sku': 'B', 'name': 'Greek Yogurt', 'emoji': '🫙', 'reason': 'commonly bought together', 'price': 2.5},
      ],
    });
    await tester.pumpWidget(MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: cart),
        ChangeNotifierProvider.value(value: wallet),
      ],
      child: const MaterialApp(home: HomeScreen()),
    ));
    expect(find.text('Banana'), findsOneWidget);
    expect(find.text('Greek Yogurt'), findsOneWidget);
    expect(find.text('commonly bought together'), findsOneWidget);
    expect(find.textContaining('Offline'), findsOneWidget);
    expect(find.textContaining('TROLLEY-100 connected'), findsNothing);
  });

  testWidgets('the catalog says when it is showing cached prices', (tester) async {
    final store = MemoryStore()
      ..values['catalog.snapshot'] = jsonEncode([
        {'sku': 'A', 'name': 'Banana', 'emoji': '🍌', 'category': 'Produce', 'price': 1.2, 'discounted': true},
      ]);
    final catalog = CatalogState(auth: authWith(200), store: store);
    await tester.pumpWidget(ChangeNotifierProvider.value(
      value: catalog,
      child: const MaterialApp(home: CatalogScreen()),
    ));
    expect(find.text('Banana'), findsOneWidget);
    expect(find.text('20% off'), findsOneWidget);
    expect(find.textContaining('Offline'), findsOneWidget);
  });
}
