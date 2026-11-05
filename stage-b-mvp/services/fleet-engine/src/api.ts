import express, { NextFunction, Request, Response } from 'express';
import { User } from './types';

type Deps = {
  health: () => unknown;
  snapshot: () => unknown;
  cartFor: (userId: string) => unknown;
  getUser: (id: string) => Promise<User | null>;
  listCustomers: () => Promise<User[]>;
  walletOf: (user: User) => Promise<unknown>;
};

// identity comes from the gateway, which has verified the token. this service isn't published
// outside the stack, so the headers can't be set by a client
function requireIdentity(req: Request, res: Response, next: NextFunction) {
  if (!req.header('x-user-id') || !req.header('x-user-role')) {
    res.status(401).json({ error: 'not logged in' });
    return;
  }
  next();
}

const isAdmin = (req: Request) => req.header('x-user-role') === 'admin';
const mayRead = (req: Request, userId: string) => isAdmin(req) || req.header('x-user-id') === userId;

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!isAdmin(req)) {
    res.status(403).json({ error: 'not allowed' });
    return;
  }
  next();
}

// runs before any lookup, so the answer doesn't reveal whether that customer exists
function requireOwner(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  if (!mayRead(req, req.params.id)) {
    res.status(403).json({ error: 'not allowed' });
    return;
  }
  next();
}

export function createApi(deps: Deps) {
  const app = express();

  app.get('/api/health', (_req, res) => {
    res.json(deps.health());
  });

  app.get('/api/fleet/trolleys', requireIdentity, requireAdmin, (_req, res) => {
    res.json(deps.snapshot());
  });

  app.get('/api/fleet/cart/:id', requireIdentity, requireOwner, (req, res) => {
    res.json(deps.cartFor(req.params.id) ?? { trolleyId: null, status: 'IDLE', items: [], total: 0 });
  });

  app.get('/api/wallets', requireIdentity, requireAdmin, async (_req, res) => {
    try {
      const customers = await deps.listCustomers();
      res.json(await Promise.all(customers.map(deps.walletOf)));
    } catch (err) {
      console.warn(`wallet list failed: ${String(err)}`);
      res.status(503).json({ error: 'wallets unavailable' });
    }
  });

  app.get('/api/wallets/:id', requireIdentity, requireOwner, async (req, res) => {
    try {
      const user = await deps.getUser(req.params.id);
      if (!user) {
        res.status(404).json({ error: 'wallet not found' });
        return;
      }
      res.json(await deps.walletOf(user));
    } catch (err) {
      console.warn(`wallet lookup failed: ${String(err)}`);
      res.status(503).json({ error: 'wallet unavailable' });
    }
  });

  return app;
}
