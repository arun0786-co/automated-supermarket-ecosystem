import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../state/wallet_state.dart';

class WalletScreen extends StatelessWidget {
  const WalletScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final wallet = context.watch<WalletState>();
    final isNegative = wallet.balance < 0;

    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1E293B),
        title: const Text('Wallet', style: TextStyle(fontWeight: FontWeight.bold)),
      ),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // balance card
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: isNegative
                      ? [const Color(0xFF450A0A), const Color(0xFF1E293B)]
                      : [const Color(0xFF1E3A5F), const Color(0xFF1E293B)],
                ),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                  color: isNegative ? const Color(0xFF991B1B) : const Color(0xFF1D4ED8),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(children: [
                    const Icon(Icons.account_balance_wallet, color: Color(0xFF60A5FA), size: 20),
                    const SizedBox(width: 8),
                    Text(wallet.name, style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 14)),
                    const Spacer(),
                    Text(wallet.userId, style: const TextStyle(color: Color(0xFF475569), fontSize: 12, fontFamily: 'monospace')),
                  ]),
                  const SizedBox(height: 20),
                  const Text('\$SPMT Balance', style: TextStyle(color: Color(0xFF64748B), fontSize: 12, letterSpacing: 2)),
                  const SizedBox(height: 4),
                  Text(
                    wallet.balance.toStringAsFixed(2),
                    style: TextStyle(
                      fontSize: 42, fontWeight: FontWeight.bold,
                      color: isNegative ? const Color(0xFFF87171) : Colors.white,
                    ),
                  ),
                  const SizedBox(height: 4),
                  if (isNegative)
                    const Text('Overdraft active — subscriber benefit',
                      style: TextStyle(color: Color(0xFFF87171), fontSize: 12)),
                ],
              ),
            ),

            const SizedBox(height: 24),
            const Text('About \$SPMT', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 16, fontWeight: FontWeight.w600)),
            const SizedBox(height: 12),

            _InfoTile(icon: Icons.link, title: 'Pegged 1:1', subtitle: 'Each \$SPMT equals 1 unit of local fiat currency'),
            _InfoTile(icon: Icons.speed, title: 'Instant Settlement', subtitle: 'IBFT 2.0 consensus — no waiting for block confirmations'),
            _InfoTile(icon: Icons.credit_score, title: 'Trusted Overdraft', subtitle: 'Subscribers can go up to −\$20 SPMT for trusted checkout'),
          ],
        ),
      ),
    );
  }
}

class _InfoTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  const _InfoTile({required this.icon, required this.title, required this.subtitle});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: const Color(0xFF1E293B),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFF334155)),
      ),
      child: Row(children: [
        Icon(icon, color: const Color(0xFF60A5FA), size: 20),
        const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 14)),
          Text(subtitle, style: const TextStyle(color: Color(0xFF64748B), fontSize: 12)),
        ])),
      ]),
    );
  }
}
