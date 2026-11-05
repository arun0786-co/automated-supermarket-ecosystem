// the event shapes below are the stage A ones, so the dashboard and app work against either stage

export type Product = {
  sku: string;
  name: string;
  emoji: string;
  category: string;
  price: number;
  weight: number;
  stockLevel: number;
  discountThreshold: number;
  daysToExpiry: number;
  discounted: boolean;
};

export type CartItem = {
  sku: string;
  name: string;
  emoji: string;
  category?: string;
  confidence: number;
  weightDelta: number;
  price: number;
  discounted: boolean;
  ts: string;
};

export type TrolleyStatus = 'IDLE' | 'SHOPPING' | 'CHECKOUT';

export type Cart = {
  trolleyId: string;
  userId: string;
  status: TrolleyStatus;
  items: CartItem[];
  totalWeight: number;
  cartTotal: number;
  // recent scan ids, kept with the cart so a redelivery is recognised after a restart
  recentEvents: string[];
};

export type VisionRequest = {
  weightDelta: number;
  frames?: string[];
  detection?: { sku: string; confidence: number };
};

export type VisionResult = {
  sku: string | null;
  confidence: number;
  fusionProbability: number;
  accepted: boolean;
  reason?: string | null;
  source: 'model' | 'simulated';
};

export type ChargeResult = { ok: boolean; hash?: string; reason?: string; overdraftUsed?: number };

export type User = { id: string; name: string; walletAddress: string };

export type Recommendation = { sku: string; name: string; emoji: string; category: string; price: number; reason: string; score: number };

// the request may have reached the chain, so it can be neither retried nor treated as failed
export class ChargeUnknownError extends Error {}

export interface Services {
  scan(req: VisionRequest): Promise<VisionResult>;
  getProduct(sku: string): Promise<Product | null>;
  // new stock level, or null if there isn't enough left
  pick(sku: string): Promise<number | null>;
  release(sku: string, quantity: number): Promise<void>;
  // throws ChargeUnknownError if the outcome can't be known, anything else means no charge
  checkout(address: string, amount: string, skus: string[]): Promise<ChargeResult>;
  getUser(id: string): Promise<User | null>;
  recordPurchase(skus: string[]): Promise<void>;
  recommend(userId: string, cart: CartItem[], context: RecommendationContext): Promise<Recommendation[]>;
  sendFeedback(sku: string, reward: 0 | 1, context: RecommendationContext): Promise<void>;
}

export type RecommendationContext = { aisle: number; hour: number; cartCategories: string[] };

export interface CartStore {
  save(cart: Cart): Promise<void>;
  loadAll(): Promise<Cart[]>;
}
