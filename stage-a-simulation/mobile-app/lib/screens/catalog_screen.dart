import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../state/catalog_state.dart';

// the product list with live prices. works from the device cache when there's no signal
class CatalogScreen extends StatelessWidget {
  const CatalogScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final catalog = context.watch<CatalogState>();
    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1E293B),
        title: const Text('Products', style: TextStyle(fontWeight: FontWeight.bold)),
      ),
      body: Column(
        children: [
          if (catalog.fromCache)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(10),
              color: const Color(0xFF422006),
              child: const Text(
                'Offline. Prices may have changed.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Color(0xFFFBBF24), fontSize: 12),
              ),
            ),
          Expanded(
            child: catalog.products.isEmpty
                ? const Center(
                    child: Text('No products yet.\nPull down to try again.',
                        textAlign: TextAlign.center, style: TextStyle(color: Color(0xFF64748B))),
                  )
                : RefreshIndicator(
                    onRefresh: catalog.refresh,
                    child: ListView.separated(
                      padding: const EdgeInsets.all(16),
                      itemCount: catalog.products.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 8),
                      itemBuilder: (_, i) => _ProductTile(product: catalog.products[i]),
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

class _ProductTile extends StatelessWidget {
  final Map<String, dynamic> product;
  const _ProductTile({required this.product});

  @override
  Widget build(BuildContext context) {
    final discounted = product['discounted'] == true;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0xFF1E293B),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFF334155)),
      ),
      child: Row(
        children: [
          Text(product['emoji'] as String? ?? '📦', style: const TextStyle(fontSize: 22)),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(product['name'] as String? ?? '', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
                Text(product['category'] as String? ?? '', style: const TextStyle(color: Color(0xFF64748B), fontSize: 12)),
              ],
            ),
          ),
          if (discounted)
            const Padding(
              padding: EdgeInsets.only(right: 8),
              child: Text('20% off', style: TextStyle(color: Color(0xFFFBBF24), fontSize: 12)),
            ),
          Text(
            '${((product['price'] as num?) ?? 0).toStringAsFixed(2)} SPMT',
            style: const TextStyle(color: Color(0xFF4ADE80), fontWeight: FontWeight.bold, fontSize: 13),
          ),
        ],
      ),
    );
  }
}
