import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../config.dart';

// bottom navigation shared by home, cart and wallet
class AppShell extends StatelessWidget {
  final Widget child;
  const AppShell({super.key, required this.child});

  // the catalog needs the stage B gateway, the stage A app doesn't have it
  static const _paths = requireLogin ? ['/', '/products', '/cart', '/wallet'] : ['/', '/cart', '/wallet'];

  @override
  Widget build(BuildContext context) {
    final location = GoRouterState.of(context).uri.path;
    final index = _paths.indexOf(location);

    return Scaffold(
      body: child,
      bottomNavigationBar: NavigationBar(
        backgroundColor: const Color(0xFF1E293B),
        selectedIndex: index < 0 ? 0 : index,
        onDestinationSelected: (i) => context.go(_paths[i]),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), label: 'Home'),
          if (requireLogin) NavigationDestination(icon: Icon(Icons.storefront_outlined), label: 'Products'),
          NavigationDestination(icon: Icon(Icons.shopping_cart_outlined), label: 'Cart'),
          NavigationDestination(icon: Icon(Icons.account_balance_wallet_outlined), label: 'Wallet'),
        ],
      ),
    );
  }
}
