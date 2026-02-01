// product catalog — keeping this as a flat array for now since we don't have a DB yet
// when stage B is up and running, this moves into postgres and gets loaded via prisma
// weights are the "standard" values — the trolley sensor adds ±5% noise on top
// daysToExpiry of 0 means the item doesn't expire (tinned goods, dry stuff etc.)

export type Product = {
  sku: string;
  name: string;
  category: string;
  price: number;        // in SPMT
  weight: number;       // grams ± 5%
  emoji: string;
  daysToExpiry: number; // 0 = non-perishable
};

export const PRODUCTS: Product[] = [
  // Produce
  { sku: 'PRD-001', name: 'Banana',          category: 'Produce',   price: 1.20, weight: 150,  emoji: '🍌', daysToExpiry: 5  },
  { sku: 'PRD-002', name: 'Apple',           category: 'Produce',   price: 0.80, weight: 182,  emoji: '🍎', daysToExpiry: 14 },
  { sku: 'PRD-003', name: 'Orange',          category: 'Produce',   price: 0.90, weight: 200,  emoji: '🍊', daysToExpiry: 10 },
  { sku: 'PRD-004', name: 'Avocado',         category: 'Produce',   price: 1.50, weight: 200,  emoji: '🥑', daysToExpiry: 4  },
  { sku: 'PRD-005', name: 'Tomato',          category: 'Produce',   price: 0.60, weight: 120,  emoji: '🍅', daysToExpiry: 7  },
  { sku: 'PRD-006', name: 'Broccoli',        category: 'Produce',   price: 1.20, weight: 350,  emoji: '🥦', daysToExpiry: 5  },
  { sku: 'PRD-007', name: 'Carrot 500g',     category: 'Produce',   price: 0.90, weight: 500,  emoji: '🥕', daysToExpiry: 14 },
  { sku: 'PRD-008', name: 'Spinach 200g',    category: 'Produce',   price: 1.80, weight: 200,  emoji: '🥬', daysToExpiry: 3  },
  // Dairy
  { sku: 'DRY-001', name: 'Full Cream Milk', category: 'Dairy',     price: 1.50, weight: 1000, emoji: '🥛', daysToExpiry: 7  },
  { sku: 'DRY-002', name: 'Almond Milk',     category: 'Dairy',     price: 3.20, weight: 1000, emoji: '🥛', daysToExpiry: 30 },
  { sku: 'DRY-003', name: 'Greek Yogurt',    category: 'Dairy',     price: 2.50, weight: 500,  emoji: '🫙', daysToExpiry: 10 },
  { sku: 'DRY-004', name: 'Cheddar Cheese',  category: 'Dairy',     price: 4.00, weight: 400,  emoji: '🧀', daysToExpiry: 21 },
  { sku: 'DRY-005', name: 'Butter 250g',     category: 'Dairy',     price: 2.80, weight: 250,  emoji: '🧈', daysToExpiry: 60 },
  // Bakery
  { sku: 'BKR-001', name: 'White Bread',     category: 'Bakery',    price: 2.00, weight: 700,  emoji: '🍞', daysToExpiry: 5  },
  { sku: 'BKR-002', name: 'Sourdough Loaf',  category: 'Bakery',    price: 4.50, weight: 800,  emoji: '🍞', daysToExpiry: 4  },
  { sku: 'BKR-003', name: 'Croissant x2',    category: 'Bakery',    price: 3.00, weight: 200,  emoji: '🥐', daysToExpiry: 2  },
  // Pantry
  { sku: 'PNT-001', name: 'Cereal Box',      category: 'Pantry',    price: 4.50, weight: 450,  emoji: '🥣', daysToExpiry: 0  },
  { sku: 'PNT-002', name: 'Pasta 500g',      category: 'Pantry',    price: 1.80, weight: 500,  emoji: '🍝', daysToExpiry: 0  },
  { sku: 'PNT-003', name: 'Olive Oil 500ml', category: 'Pantry',    price: 6.50, weight: 550,  emoji: '🫙', daysToExpiry: 0  },
  { sku: 'PNT-004', name: 'Rice 1kg',        category: 'Pantry',    price: 2.20, weight: 1000, emoji: '🍚', daysToExpiry: 0  },
  { sku: 'PNT-005', name: 'Oats 1kg',        category: 'Pantry',    price: 3.00, weight: 1000, emoji: '🥣', daysToExpiry: 0  },
  { sku: 'PNT-006', name: 'Granola 500g',    category: 'Pantry',    price: 5.50, weight: 500,  emoji: '🥣', daysToExpiry: 0  },
  { sku: 'PNT-007', name: 'Peanut Butter',   category: 'Pantry',    price: 3.80, weight: 400,  emoji: '🫙', daysToExpiry: 0  },
  // Beverages
  { sku: 'BVG-001', name: 'Sparkling Water', category: 'Beverages', price: 1.20, weight: 1000, emoji: '💧', daysToExpiry: 0  },
  { sku: 'BVG-002', name: 'Orange Juice 1L', category: 'Beverages', price: 2.50, weight: 1040, emoji: '🍊', daysToExpiry: 7  },
  { sku: 'BVG-003', name: 'Coffee Beans',    category: 'Beverages', price: 9.00, weight: 250,  emoji: '☕', daysToExpiry: 0  },
  { sku: 'BVG-004', name: 'Green Tea 25s',   category: 'Beverages', price: 3.50, weight: 50,   emoji: '🍵', daysToExpiry: 0  },
  // Snacks
  { sku: 'SNK-001', name: 'Dark Chocolate',  category: 'Snacks',    price: 2.80, weight: 100,  emoji: '🍫', daysToExpiry: 0  },
  { sku: 'SNK-002', name: 'Protein Bar',     category: 'Snacks',    price: 2.50, weight: 60,   emoji: '🍫', daysToExpiry: 0  },
  { sku: 'SNK-003', name: 'Potato Chips',    category: 'Snacks',    price: 2.20, weight: 180,  emoji: '🥔', daysToExpiry: 0  },
  // Meat & Fish
  { sku: 'MTF-001', name: 'Chicken Breast',  category: 'Meat',      price: 7.50, weight: 500,  emoji: '🍗', daysToExpiry: 3  },
  { sku: 'MTF-002', name: 'Salmon Fillet',   category: 'Fish',      price: 9.00, weight: 300,  emoji: '🐟', daysToExpiry: 2  },
  { sku: 'MTF-003', name: 'Eggs x12',        category: 'Dairy',     price: 3.20, weight: 600,  emoji: '🥚', daysToExpiry: 21 },
];

// apply the expiry-based discount from chapter 4 of the spec
// "IF Days_To_Expiry < 2 AND Stock_Level > Threshold THEN Apply_Discount(20%)"
// i'm ignoring the stock level part for now since we don't have real inventory counts yet
export function applyDynamicPricing(product: Product): { price: number; discounted: boolean } {
  if (product.daysToExpiry > 0 && product.daysToExpiry <= 2) {
    return { price: +(product.price * 0.8).toFixed(2), discounted: true };
  }
  return { price: product.price, discounted: false };
}
