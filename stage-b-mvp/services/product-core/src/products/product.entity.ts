import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

// mirrors the Product type from stage A but now persisted in postgres
// added stock_level because stage A was just faking that part
@Entity('products')
export class Product {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  sku: string;

  @Column()
  name: string;

  @Column()
  category: string;

  @Column('decimal', { precision: 8, scale: 2 })
  price: number;

  // grams — what the load cell should read for this item (before ±5% sensor noise)
  @Column('int')
  weight: number;

  @Column()
  emoji: string;

  // 0 = non-perishable, > 0 = days until expiry
  @Column('int', { default: 0 })
  daysToExpiry: number;

  // actual inventory — not tracked in stage A, needed for proper dynamic pricing
  @Column('int', { default: 100 })
  stockLevel: number;

  // discount threshold: if stockLevel is above this AND daysToExpiry < 2, apply discount
  @Column('int', { default: 10 })
  discountThreshold: number;

  @Column({ default: true })
  active: boolean;
}
