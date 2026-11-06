import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'config.dart';
import 'state/auth_state.dart';
import 'state/cart_state.dart';
import 'state/catalog_state.dart';
import 'state/local_store.dart';
import 'state/wallet_state.dart';
import 'screens/catalog_screen.dart';
import 'screens/home_screen.dart';
import 'screens/cart_screen.dart';
import 'screens/login_screen.dart';
import 'screens/wallet_screen.dart';
import 'widgets/app_shell.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final store = await PrefsStore.open();

  final auth = requireLogin ? AuthState(store: store) : null;
  await auth?.restore();

  final cart = CartState(auth: auth, store: auth == null ? null : store);
  final catalog = auth == null ? null : CatalogState(auth: auth, store: store);
  if (catalog != null) {
    cart.addMessageListener(catalog.handleMessage);
    if (auth!.loggedIn) catalog.refresh();
    auth.addListener(() {
      if (auth.loggedIn) catalog.refresh();
    });
  }

  runApp(
    MultiProvider(
      providers: [
        ListenableProvider<AuthState?>.value(value: auth),
        ChangeNotifierProvider.value(value: cart),
        ChangeNotifierProvider(create: (_) => WalletState(auth: auth, store: auth == null ? null : store)),
        if (catalog != null) ChangeNotifierProvider.value(value: catalog),
      ],
      child: AseApp(auth: auth),
    ),
  );
}

GoRouter buildRouter(AuthState? auth) => GoRouter(
      refreshListenable: auth,
      redirect: (_, state) {
        if (auth == null) return null;
        final atLogin = state.matchedLocation == '/login';
        if (!auth.loggedIn) return atLogin ? null : '/login';
        return atLogin ? '/' : null;
      },
      routes: [
        GoRoute(path: '/login', builder: (_, __) => const LoginScreen()),
        ShellRoute(
          builder: (_, __, child) => AppShell(child: child),
          routes: [
            GoRoute(path: '/', builder: (_, __) => const HomeScreen()),
            if (auth != null) GoRoute(path: '/products', builder: (_, __) => const CatalogScreen()),
            GoRoute(path: '/cart', builder: (_, __) => const CartScreen()),
            GoRoute(path: '/wallet', builder: (_, __) => const WalletScreen()),
          ],
        ),
      ],
    );

class AseApp extends StatefulWidget {
  final AuthState? auth;
  const AseApp({super.key, this.auth});

  @override
  State<AseApp> createState() => _AseAppState();
}

class _AseAppState extends State<AseApp> {
  late final GoRouter _router = buildRouter(widget.auth);

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'ASE-PRIME',
      debugShowCheckedModeBanner: false,
      routerConfig: _router,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF3B82F6),
          brightness: Brightness.dark,
        ),
        scaffoldBackgroundColor: const Color(0xFF0F172A),
        useMaterial3: true,
      ),
    );
  }
}
