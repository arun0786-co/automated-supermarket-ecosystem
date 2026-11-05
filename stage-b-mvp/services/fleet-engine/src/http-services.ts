import { CartItem, ChargeResult, ChargeUnknownError, Product, Recommendation, RecommendationContext, Services, User, VisionRequest, VisionResult } from './types';

type Urls = { vision: string; products: string; vault: string; auth: string; ai: string; chargeTimeoutMs?: number };

const TIMEOUT_MS = 5000;
// inference on a burst can take a moment on a small cpu
const VISION_TIMEOUT_MS = 15000;
// a chain confirmation is slower than a normal request
const CHARGE_TIMEOUT_MS = 30000;

// connection errors that prove the request never reached the vault
const NEVER_SENT = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH']);

function neverReachedServer(err: unknown): boolean {
  const code = (err as { cause?: { code?: string } }).cause?.code;
  return code !== undefined && NEVER_SENT.has(code);
}

const jsonPost = (body: unknown, timeoutMs = TIMEOUT_MS): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(timeoutMs),
});

const get = (url: string) => fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });

async function unwrap<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(`${what} returned ${res.status}`);
  return (await res.json()) as T;
}

export function httpServices(urls: Urls): Services {
  return {
    async scan(req: VisionRequest) {
      const res = await fetch(`${urls.vision}/api/vision/scan`, jsonPost(req, VISION_TIMEOUT_MS));
      return unwrap<VisionResult>(res, 'vision');
    },

    async getProduct(sku: string) {
      const res = await get(`${urls.products}/api/products/${encodeURIComponent(sku)}`);
      if (res.status === 404) return null;
      const product = await unwrap<Product>(res, 'product-core');
      return { ...product, price: Number(product.price) };
    },

    async pick(sku: string) {
      const res = await fetch(`${urls.products}/api/products/${encodeURIComponent(sku)}/pick`, jsonPost({ quantity: 1 }));
      if (res.status === 409) return null;
      return (await unwrap<{ stockLevel: number }>(res, 'product-core')).stockLevel;
    },

    async release(sku: string, quantity: number) {
      const res = await fetch(`${urls.products}/api/products/${encodeURIComponent(sku)}/release`, jsonPost({ quantity }));
      await unwrap(res, 'product-core');
    },

    // anything that might have reached the chain is reported as unknown, never as failed,
    // because the caller would give the goods back and the customer could still be charged
    async checkout(address: string, amount: string, skus: string[]): Promise<ChargeResult> {
      let res: Response;
      try {
        res = await fetch(
          `${urls.vault}/api/checkout`,
          jsonPost({ customer: address, amount, cartItems: skus.map((sku) => ({ sku })) }, urls.chargeTimeoutMs ?? CHARGE_TIMEOUT_MS),
        );
      } catch (err) {
        if (neverReachedServer(err)) throw new Error(`vault unreachable: ${String(err)}`);
        throw new ChargeUnknownError(String(err));
      }
      if (res.status >= 500) throw new ChargeUnknownError(`vault returned ${res.status}`);
      if (!res.ok) throw new Error(`vault refused the request with ${res.status}`);

      let body: { ok: boolean; hash?: string; reason?: string; overdraftUsed?: string };
      try {
        body = (await res.json()) as typeof body;
      } catch (err) {
        throw new ChargeUnknownError(`unreadable vault response: ${String(err)}`);
      }
      if (typeof body.ok !== 'boolean') throw new ChargeUnknownError('vault response had no result');
      return {
        ok: body.ok,
        ...(body.hash !== undefined ? { hash: body.hash } : {}),
        ...(body.reason !== undefined ? { reason: body.reason } : {}),
        ...(body.overdraftUsed !== undefined ? { overdraftUsed: Number(body.overdraftUsed) } : {}),
      };
    },

    async getUser(id: string) {
      const res = await get(`${urls.auth}/internal/users/${encodeURIComponent(id)}`);
      if (res.status === 404) return null;
      return unwrap<User>(res, 'auth-service');
    },

    async recordPurchase(_userId: string, skus: string[]) {
      // no user id leaves this service: the model learns from anonymous baskets (chapter 7.4)
      const res = await fetch(`${urls.ai}/api/events/purchase`, jsonPost({ skus }));
      await unwrap(res, 'ai-engine');
    },

    async recommend(userId: string, cart: CartItem[], context: RecommendationContext) {
      const res = await fetch(
        `${urls.ai}/api/recommendations`,
        jsonPost({
          userId,
          cartItems: cart.map((item) => ({ sku: item.sku, name: item.name, category: item.category ?? 'Unknown' })),
          limit: 3,
          context,
        }),
      );
      return unwrap<Recommendation[]>(res, 'ai-engine');
    },

    async sendFeedback(userId: string, sku: string, reward: number, context: RecommendationContext) {
      const res = await fetch(`${urls.ai}/api/recommendations/feedback`, jsonPost({ userId, sku, reward, context }));
      await unwrap(res, 'ai-engine');
    },
  };
}

// the customer list and balances for the dashboard's wallet cards. the shape is stage A's
export async function fetchWallet(urls: Pick<Urls, 'vault'>, user: User) {
  const res = await get(`${urls.vault}/api/wallet/${encodeURIComponent(user.walletAddress)}`);
  const wallet = await unwrap<{ balance: string; overdraftOwed: string; overdraftLimit: string; isSubscriber: boolean }>(res, 'vault');
  return {
    userId: user.id,
    name: user.name,
    // on chain the balance stops at zero and debt is tracked separately. customers see one number
    balance: Math.round((Number(wallet.balance) - Number(wallet.overdraftOwed)) * 100) / 100,
    overdraftLimit: -Number(wallet.overdraftLimit),
    isSubscriber: wallet.isSubscriber,
  };
}

export async function fetchCustomers(urls: Pick<Urls, 'auth'>): Promise<User[]> {
  return unwrap<User[]>(await get(`${urls.auth}/internal/customers`), 'auth-service');
}
