import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../state/cart_state.dart';
import '../state/wallet_state.dart';

// home screen — connects to WebSocket and shows the live cart + recommendations
class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final cart   = context.watch<CartState>();
    final wallet = context.watch<WalletState>();

    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1E293B),
        title: const Text('ASE-PRIME', style: TextStyle(fontWeight: FontWeight.bold)),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 16),
            child: Chip(
              backgroundColor: const Color(0xFF1E3A5F),
              label: Text(
                '${wallet.balance.toStringAsFixed(2)} SPMT',
                style: const TextStyle(color: Color(0xFF60A5FA), fontSize: 12, fontWeight: FontWeight.bold),
              ),
              avatar: const Icon(Icons.account_balance_wallet, size: 14, color: Color(0xFF60A5FA)),
            ),
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // connection status
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              decoration: BoxDecoration(
                color: cart.connected ? const Color(0xFF052E16) : const Color(0xFF450A0A),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: cart.connected ? const Color(0xFF16A34A) : const Color(0xFFDC2626),
                ),
              ),
              child: Row(
                children: [
                  Container(
                    width: 8, height: 8,
                    decoration: BoxDecoration(
                      color: cart.connected ? const Color(0xFF4ADE80) : const Color(0xFFF87171),
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    cart.connected ? 'Trolley TROLLEY-100 connected' : 'Connecting to fleet…',
                    style: TextStyle(
                      color: cart.connected ? const Color(0xFF4ADE80) : const Color(0xFFF87171),
                      fontSize: 13,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),

            // cart summary
            const Text('Your Cart', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Colors.white)),
            const SizedBox(height: 10),
            if (cart.items.isEmpty)
              const Center(
                child: Padding(
                  padding: EdgeInsets.all(40),
                  child: Text('Start shopping — items appear automatically!',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Color(0xFF64748B), fontSize: 13)),
                ),
              )
            else
              ...cart.items.take(5).map((item) => _CartItemTile(item: item)),

            if (cart.items.length > 5)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text('+${cart.items.length - 5} more items',
                  style: const TextStyle(color: Color(0xFF60A5FA), fontSize: 13)),
              ),

            const SizedBox(height: 24),

            // total
            if (cart.items.isNotEmpty)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: const Color(0xFF1E293B),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: const Color(0xFF334155)),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Cart Total', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 14)),
                    Text(
                      '${cart.total.toStringAsFixed(2)} SPMT',
                      style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Color(0xFF4ADE80)),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
      bottomNavigationBar: NavigationBar(
        backgroundColor: const Color(0xFF1E293B),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), label: 'Home'),
          NavigationDestination(icon: Icon(Icons.shopping_cart_outlined), label: 'Cart'),
          NavigationDestination(icon: Icon(Icons.account_balance_wallet_outlined), label: 'Wallet'),
        ],
      ),
    );
  }
}

class _CartItemTile extends StatelessWidget {
  final Map<String, dynamic> item;
  const _CartItemTile({required this.item});

  @override
  Widget build(BuildContext context) {
    final confidence = (item['confidence'] as num).toDouble();
    final ok = confidence >= 0.80;
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0xFF1E293B),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFF334155)),
      ),
      child: Row(
        children: [
          Text(item['emoji'] ?? '📦', style: const TextStyle(fontSize: 22)),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(item['name'] ?? '', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 14)),
              Text('${(item['weightDelta'] as num).toStringAsFixed(0)}g · confidence ${(confidence * 100).toStringAsFixed(0)}%',
                style: const TextStyle(color: Color(0xFF64748B), fontSize: 11)),
            ]),
          ),
          Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Text('${(item['price'] as num).toStringAsFixed(2)} SPMT',
              style: const TextStyle(color: Color(0xFF4ADE80), fontWeight: FontWeight.bold, fontSize: 13)),
            Icon(ok ? Icons.check_circle : Icons.cancel, size: 14, color: ok ? const Color(0xFF4ADE80) : const Color(0xFFF87171)),
          ]),
        ],
      ),
    );
  }
}
