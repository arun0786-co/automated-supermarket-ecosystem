import 'dart:async';
import 'dart:convert';

import 'package:ase_mobile/state/auth_state.dart';
import 'package:ase_mobile/state/local_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

String fake(String kind, int n) => '$kind-$n';

Map<String, dynamic> tokens(int n, {int expiresIn = 900}) => {
      'accessToken': fake('access', n),
      'refreshToken': fake('refresh', n),
      'expiresIn': expiresIn,
      'user': {'id': 'USR-001', 'name': 'Arun K.', 'role': 'customer'},
    };

http.Response json(Object body, [int status = 200]) => http.Response(jsonEncode(body), status);

class Clock {
  DateTime now = DateTime(2026, 11, 6, 12);
  void advance(Duration d) => now = now.add(d);
}

AuthState build(MockClient client, {MemoryStore? store, Clock? clock}) => AuthState(
      store: store ?? MemoryStore(),
      client: client,
      base: 'http://gw',
      now: () => (clock ?? Clock()).now,
    );

void main() {
  group('login', () {
    test('signs in and keeps the access token out of storage', () async {
      final store = MemoryStore();
      final auth = build(MockClient((_) async => json(tokens(1))), store: store);
      await auth.login('a@b.c', 'pw');
      expect(auth.loggedIn, isTrue);
      expect(auth.userId, 'USR-001');
      expect(auth.name, 'Arun K.');
      expect(await auth.token(), 'access-1');
      expect(store.values.values.join(), isNot(contains('access-1')));
    });

    test('a wrong password says so', () async {
      final auth = build(MockClient((_) async => json({'error': 'x'}, 401)));
      await expectLater(auth.login('a@b.c', 'no'), throwsA(isA<AuthError>().having((e) => e.message, 'message', 'Invalid email or password')));
      expect(auth.loggedIn, isFalse);
    });

    test('being rate limited has its own message', () async {
      final auth = build(MockClient((_) async => json({}, 429)));
      await expectLater(auth.login('a@b.c', 'pw'), throwsA(isA<AuthError>().having((e) => e.message, 'message', contains('Too many'))));
    });

    test('no network has its own message', () async {
      final auth = build(MockClient((_) async => throw http.ClientException('no route')));
      await expectLater(auth.login('a@b.c', 'pw'), throwsA(isA<AuthError>().having((e) => e.message, 'message', contains('reach'))));
    });
  });

  group('refresh', () {
    test('happens before the token runs out', () async {
      final clock = Clock();
      final auth = build(
        MockClient((req) async => json(tokens(req.url.path.endsWith('refresh') ? 2 : 1))),
        clock: clock,
      );
      await auth.login('a@b.c', 'pw');
      clock.advance(const Duration(seconds: 890));
      expect(await auth.token(), 'access-2');
    });

    // a refresh token works once and reuse revokes the session, so racing would log people out
    test('calls at the same moment share one refresh', () async {
      final clock = Clock();
      var refreshes = 0;
      final gate = Completer<void>();
      final auth = build(
        MockClient((req) async {
          if (req.url.path.endsWith('refresh')) {
            refreshes++;
            await gate.future;
            return json(tokens(2));
          }
          return json(tokens(1));
        }),
        clock: clock,
      );
      await auth.login('a@b.c', 'pw');
      clock.advance(const Duration(hours: 1));
      final pending = Future.wait([auth.token(), auth.token(), auth.token()]);
      gate.complete();
      expect(await pending, ['access-2', 'access-2', 'access-2']);
      expect(refreshes, 1);
    });

    test('being refused ends the session and tells listeners', () async {
      final clock = Clock();
      final store = MemoryStore();
      final auth = build(
        MockClient((req) async => req.url.path.endsWith('refresh') ? json({}, 401) : json(tokens(1))),
        store: store,
        clock: clock,
      );
      await auth.login('a@b.c', 'pw');
      var told = 0;
      auth.addListener(() => told++);
      clock.advance(const Duration(hours: 1));
      expect(await auth.token(), isNull);
      expect(auth.loggedIn, isFalse);
      expect(told, greaterThan(0));
      expect(store.values, isEmpty);
    });

    test('a network blip does not log anyone out', () async {
      final clock = Clock();
      var down = true;
      final auth = build(
        MockClient((req) async {
          if (!req.url.path.endsWith('refresh')) return json(tokens(1));
          if (down) throw http.ClientException('no route');
          return json(tokens(2));
        }),
        clock: clock,
      );
      await auth.login('a@b.c', 'pw');
      clock.advance(const Duration(hours: 1));
      expect(await auth.token(), isNull);
      expect(auth.loggedIn, isTrue);
      down = false;
      expect(await auth.token(), 'access-2');
    });
  });

  group('restore', () {
    test('picks the session back up after a restart', () async {
      final store = MemoryStore();
      await build(MockClient((_) async => json(tokens(1))), store: store).login('a@b.c', 'pw');

      final again = build(MockClient((_) async => json(tokens(2))), store: store);
      expect(await again.restore(), isTrue);
      expect(await again.token(), 'access-2');
    });

    // the spec's point: supermarkets have bad reception, and that shouldn't mean a login wall
    test('starting with no network still opens the app for a known user', () async {
      final store = MemoryStore();
      await build(MockClient((_) async => json(tokens(1))), store: store).login('a@b.c', 'pw');

      final offline = build(MockClient((_) async => throw http.ClientException('no route')), store: store);
      expect(await offline.restore(), isTrue);
      expect(offline.name, 'Arun K.');
      expect(await offline.token(), isNull);
    });

    test('a session the server refuses goes back to login', () async {
      final store = MemoryStore();
      await build(MockClient((_) async => json(tokens(1))), store: store).login('a@b.c', 'pw');

      final refused = build(MockClient((_) async => json({}, 401)), store: store);
      expect(await refused.restore(), isFalse);
      expect(refused.loggedIn, isFalse);
    });

    test('nothing stored makes no request', () async {
      var calls = 0;
      final auth = build(MockClient((_) async {
        calls++;
        return json({});
      }));
      expect(await auth.restore(), isFalse);
      expect(calls, 0);
    });

    test('a damaged profile is treated as logged out', () async {
      final store = MemoryStore()..values['auth.user'] = '{broken';
      final auth = build(MockClient((_) async => json({})), store: store);
      expect(await auth.restore(), isFalse);
    });
  });

  group('requests', () {
    test('send the token', () async {
      String? seen;
      final auth = build(MockClient((req) async {
        seen = req.headers['authorization'];
        return json(tokens(1));
      }));
      await auth.login('a@b.c', 'pw');
      await auth.get('/api/products');
      expect(seen, 'Bearer access-1');
    });

    test('retry once with a fresh token after a 401', () async {
      var first = true;
      final auth = build(MockClient((req) async {
        if (req.url.path.endsWith('login')) return json(tokens(1));
        if (req.url.path.endsWith('refresh')) return json(tokens(2));
        if (first) {
          first = false;
          return json({}, 401);
        }
        return json({'ok': true});
      }));
      await auth.login('a@b.c', 'pw');
      expect((await auth.get('/api/products')).statusCode, 200);
    });
  });

  group('leaving', () {
    test('logout clears the device even with no network', () async {
      final store = MemoryStore();
      final auth = build(
        MockClient((req) async {
          if (req.url.path.endsWith('logout')) throw http.ClientException('no route');
          return json(tokens(1));
        }),
        store: store,
      );
      await auth.login('a@b.c', 'pw');
      await auth.logout();
      expect(auth.loggedIn, isFalse);
      expect(store.values, isEmpty);
    });

    test('forgetting an account needs the right password', () async {
      final auth = build(MockClient((req) async {
        if (req.method == 'DELETE') return json({}, 401);
        return json(tokens(1));
      }));
      await auth.login('a@b.c', 'pw');
      await expectLater(auth.forget('wrong'), throwsA(isA<AuthError>()));
      expect(auth.loggedIn, isTrue);
    });

    test('forgetting an account ends the session', () async {
      String? sent;
      final store = MemoryStore();
      final auth = build(
        MockClient((req) async {
          if (req.method == 'DELETE') {
            sent = req.body;
            return http.Response('', 204);
          }
          return json(tokens(1));
        }),
        store: store,
      );
      await auth.login('a@b.c', 'pw');
      await auth.forget('pw');
      expect(jsonDecode(sent!), {'password': 'pw'});
      expect(auth.loggedIn, isFalse);
      expect(store.values, isEmpty);
    });
  });
}
