import 'package:ase_mobile/state/cart_state.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> scan(String trolleyId, {bool accepted = true, num price = 2.5}) => {
      'type': 'SCAN_EVENT',
      'trolleyId': trolleyId,
      'event': {'sku': 'PNT-001', 'name': 'Cereal Box', 'price': price, 'accepted': accepted},
    };

void main() {
  test('adds accepted scans for our trolley and sums the total', () {
    final cart = CartState(connect: false);
    cart.handleMessage(scan('TROLLEY-100', price: 4.5));
    cart.handleMessage(scan('TROLLEY-100', price: 1.2));
    expect(cart.items.length, 2);
    expect(cart.total, 5.7);
  });

  test('ignores rejected scans and other trolleys', () {
    final cart = CartState(connect: false);
    cart.handleMessage(scan('TROLLEY-100', accepted: false));
    cart.handleMessage(scan('TROLLEY-101'));
    expect(cart.items, isEmpty);
    expect(cart.total, 0);
  });

  test('clears the cart on checkout', () {
    final cart = CartState(connect: false);
    cart.handleMessage(scan('TROLLEY-100'));
    cart.handleMessage({'type': 'CHECKOUT_EVENT', 'trolleyId': 'TROLLEY-100'});
    expect(cart.items, isEmpty);
    expect(cart.total, 0);
  });
}
