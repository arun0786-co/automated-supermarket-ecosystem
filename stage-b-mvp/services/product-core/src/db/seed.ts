import { DataSource } from 'typeorm';
import { Product } from '../products/product.entity';
import { dbOptions } from './config';

// run once to populate the products table from the stage A catalog
// usage: npm run seed
const ds = new DataSource({ ...dbOptions, entities: [Product], synchronize: true });

// copied from stage A products.ts, same data, now going into postgres
const SEED_DATA: Partial<Product>[] = [
  { sku: 'PRD-001', name: 'Banana',          category: 'Produce',   price: 1.20, weight: 150,  emoji: '🍌', daysToExpiry: 5,  stockLevel: 80 },
  { sku: 'PRD-002', name: 'Apple',           category: 'Produce',   price: 0.80, weight: 182,  emoji: '🍎', daysToExpiry: 14, stockLevel: 120 },
  { sku: 'PRD-003', name: 'Orange',          category: 'Produce',   price: 0.90, weight: 200,  emoji: '🍊', daysToExpiry: 10, stockLevel: 90 },
  { sku: 'PRD-004', name: 'Avocado',         category: 'Produce',   price: 1.50, weight: 200,  emoji: '🥑', daysToExpiry: 4,  stockLevel: 7  },
  { sku: 'PRD-005', name: 'Tomato',          category: 'Produce',   price: 0.60, weight: 120,  emoji: '🍅', daysToExpiry: 7,  stockLevel: 60 },
  { sku: 'PRD-006', name: 'Broccoli',        category: 'Produce',   price: 1.20, weight: 350,  emoji: '🥦', daysToExpiry: 5,  stockLevel: 40 },
  { sku: 'PRD-007', name: 'Carrot 500g',     category: 'Produce',   price: 0.90, weight: 500,  emoji: '🥕', daysToExpiry: 14, stockLevel: 200 },
  { sku: 'PRD-008', name: 'Spinach 200g',    category: 'Produce',   price: 1.80, weight: 200,  emoji: '🥬', daysToExpiry: 3,  stockLevel: 8  },
  { sku: 'DRY-001', name: 'Full Cream Milk', category: 'Dairy',     price: 1.50, weight: 1000, emoji: '🥛', daysToExpiry: 7,  stockLevel: 150 },
  { sku: 'DRY-002', name: 'Almond Milk',     category: 'Dairy',     price: 3.20, weight: 1000, emoji: '🥛', daysToExpiry: 30, stockLevel: 60 },
  { sku: 'DRY-003', name: 'Greek Yogurt',    category: 'Dairy',     price: 2.50, weight: 500,  emoji: '🫙', daysToExpiry: 10, stockLevel: 45 },
  { sku: 'DRY-004', name: 'Cheddar Cheese',  category: 'Dairy',     price: 4.00, weight: 400,  emoji: '🧀', daysToExpiry: 21, stockLevel: 35 },
  { sku: 'DRY-005', name: 'Butter 250g',     category: 'Dairy',     price: 2.80, weight: 250,  emoji: '🧈', daysToExpiry: 60, stockLevel: 80 },
  { sku: 'BKR-001', name: 'White Bread',     category: 'Bakery',    price: 2.00, weight: 700,  emoji: '🍞', daysToExpiry: 5,  stockLevel: 30 },
  { sku: 'BKR-002', name: 'Sourdough Loaf',  category: 'Bakery',    price: 4.50, weight: 800,  emoji: '🍞', daysToExpiry: 4,  stockLevel: 12 },
  { sku: 'BKR-003', name: 'Croissant x2',    category: 'Bakery',    price: 3.00, weight: 200,  emoji: '🥐', daysToExpiry: 1,  stockLevel: 40 },  // expires tomorrow, overstocked: discounted
  { sku: 'PNT-001', name: 'Cereal Box',      category: 'Pantry',    price: 4.50, weight: 450,  emoji: '🥣', daysToExpiry: 0,  stockLevel: 200 },
  { sku: 'PNT-002', name: 'Pasta 500g',      category: 'Pantry',    price: 1.80, weight: 500,  emoji: '🍝', daysToExpiry: 0,  stockLevel: 300 },
  { sku: 'PNT-003', name: 'Olive Oil 500ml', category: 'Pantry',    price: 6.50, weight: 550,  emoji: '🫙', daysToExpiry: 0,  stockLevel: 80 },
  { sku: 'PNT-004', name: 'Rice 1kg',        category: 'Pantry',    price: 2.20, weight: 1000, emoji: '🍚', daysToExpiry: 0,  stockLevel: 250 },
  { sku: 'PNT-005', name: 'Oats 1kg',        category: 'Pantry',    price: 3.00, weight: 1000, emoji: '🥣', daysToExpiry: 0,  stockLevel: 120 },
  { sku: 'PNT-006', name: 'Granola 500g',    category: 'Pantry',    price: 5.50, weight: 500,  emoji: '🥣', daysToExpiry: 0,  stockLevel: 70 },
  { sku: 'PNT-007', name: 'Peanut Butter',   category: 'Pantry',    price: 3.80, weight: 400,  emoji: '🫙', daysToExpiry: 0,  stockLevel: 90 },
  { sku: 'BVG-001', name: 'Sparkling Water', category: 'Beverages', price: 1.20, weight: 1000, emoji: '💧', daysToExpiry: 0,  stockLevel: 400 },
  { sku: 'BVG-002', name: 'Orange Juice 1L', category: 'Beverages', price: 2.50, weight: 1040, emoji: '🍊', daysToExpiry: 7,  stockLevel: 100 },
  { sku: 'BVG-003', name: 'Coffee Beans',    category: 'Beverages', price: 9.00, weight: 250,  emoji: '☕', daysToExpiry: 0,  stockLevel: 50 },
  { sku: 'BVG-004', name: 'Green Tea 25s',   category: 'Beverages', price: 3.50, weight: 50,   emoji: '🍵', daysToExpiry: 0,  stockLevel: 80 },
  { sku: 'SNK-001', name: 'Dark Chocolate',  category: 'Snacks',    price: 2.80, weight: 100,  emoji: '🍫', daysToExpiry: 0,  stockLevel: 150 },
  { sku: 'SNK-002', name: 'Protein Bar',     category: 'Snacks',    price: 2.50, weight: 60,   emoji: '🍫', daysToExpiry: 0,  stockLevel: 200 },
  { sku: 'SNK-003', name: 'Potato Chips',    category: 'Snacks',    price: 2.20, weight: 180,  emoji: '🥔', daysToExpiry: 0,  stockLevel: 120 },
  { sku: 'MTF-001', name: 'Chicken Breast',  category: 'Meat',      price: 7.50, weight: 500,  emoji: '🍗', daysToExpiry: 3,  stockLevel: 25 },
  { sku: 'MTF-002', name: 'Salmon Fillet',   category: 'Fish',      price: 9.00, weight: 300,  emoji: '🐟', daysToExpiry: 1,  stockLevel: 6  },  // expires tomorrow but nearly sold out: full price
  { sku: 'MTF-003', name: 'Eggs x12',        category: 'Dairy',     price: 3.20, weight: 600,  emoji: '🥚', daysToExpiry: 21, stockLevel: 60 },
];

async function seed() {
  await ds.initialize();
  console.log('db connected, seeding...');
  const repo = ds.getRepository(Product);
  // insert missing products only, so re-running on startup never resets live stock levels
  let added = 0;
  for (const item of SEED_DATA) {
    if (await repo.findOne({ where: { sku: item.sku } })) continue;
    await repo.save(repo.create(item));
    added++;
  }
  console.log(`seeded ${added} new products (${SEED_DATA.length - added} already there)`);
  await ds.destroy();
}

seed().catch(console.error);
