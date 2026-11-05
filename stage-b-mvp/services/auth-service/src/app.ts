import { createHash, randomBytes, randomUUID } from 'node:crypto';
import express, { NextFunction, Request, Response } from 'express';
import { SignJWT, jwtVerify } from 'jose';
import { DEFAULT_COST, hashPassword, verifyPassword } from './passwords';
import { User, Users } from './users';

const ISSUER = 'ase-auth';
// chapter 10.1: short-lived tokens
const ACCESS_TOKEN_SECONDS = 15 * 60;
const REFRESH_TOKEN_MS = 7 * 24 * 60 * 60 * 1000;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;
const MAX_NAME = 100;

type Options = {
  users: Users;
  jwtSecret: string;
  scryptCost?: number;
  now?: () => number;
};

const sha256 = (value: string) => createHash('sha256').update(value).digest('base64url');
const newUserId = () => `USR-${randomBytes(6).toString('hex')}`;
// an address nobody holds a key for. the vault signs for customers, this only identifies them
const newWalletAddress = () => `0x${randomBytes(20).toString('hex')}`;

const publicUser = (u: User) => ({ id: u.id, name: u.name, role: u.role });
const internalUser = (u: User) => ({ id: u.id, name: u.name, walletAddress: u.walletAddress });

const isString = (v: unknown): v is string => typeof v === 'string';

export function createApp({ users, jwtSecret, scryptCost = DEFAULT_COST, now = Date.now }: Options) {
  const secret = new TextEncoder().encode(jwtSecret);
  const app = express();
  app.use(express.json({ limit: '10kb' }));

  // spent on unknown emails too, so response time doesn't reveal which accounts exist
  const dummyHash = hashPassword(randomBytes(16).toString('hex'), scryptCost);

  async function issueTokens(user: User, family: string = randomUUID()) {
    const accessToken = await new SignJWT({ role: user.role })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuer(ISSUER)
      .setIssuedAt(Math.floor(now() / 1000))
      .setExpirationTime(Math.floor(now() / 1000) + ACCESS_TOKEN_SECONDS)
      .sign(secret);
    const refreshToken = randomBytes(32).toString('base64url');
    // only the hash is stored, so a database leak doesn't hand out sessions
    await users.storeRefresh({ hash: sha256(refreshToken), userId: user.id, family, expiresAt: now() + REFRESH_TOKEN_MS });
    return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_SECONDS, user: publicUser(user) };
  }

  // the signature proves who it was issued to, the lookup proves they still exist
  async function userFromToken(token: string | undefined) {
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, secret, { issuer: ISSUER, algorithms: ['HS256'] });
      const user = payload.sub ? await users.findById(payload.sub) : null;
      return user ? { user, exp: payload.exp ?? 0 } : null;
    } catch {
      return null;
    }
  }

  function bearer(req: Request): string | undefined {
    const header = req.headers.authorization;
    return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
  }

  // browsers can't set headers on a websocket, so nginx forwards the url and the token is in it
  function tokenFromOriginalUri(req: Request): string | undefined {
    const uri = req.headers['x-original-uri'];
    if (!isString(uri)) return undefined;
    return new URL(uri, 'http://gateway').searchParams.get('token') ?? undefined;
  }

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'auth-service', stage: 'B' });
  });

  app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body ?? {};
    if (!isString(email) || !isString(password) || password.length > MAX_PASSWORD) {
      res.status(400).json({ error: 'email and password required' });
      return;
    }
    const user = await users.findByEmail(email.toLowerCase());
    const matches = await verifyPassword(password, user?.passwordHash ?? (await dummyHash));
    if (!user || !matches) {
      res.status(401).json({ error: 'invalid email or password' });
      return;
    }
    res.json(await issueTokens(user));
  });

  app.post('/api/auth/register', async (req, res) => {
    const { email, name, password } = req.body ?? {};
    if (
      !isString(email) || !EMAIL.test(email) ||
      !isString(name) || name.trim().length === 0 || name.length > MAX_NAME ||
      !isString(password) || password.length < MIN_PASSWORD || password.length > MAX_PASSWORD
    ) {
      res.status(400).json({ error: `valid email, name and a password of ${MIN_PASSWORD} to ${MAX_PASSWORD} characters required` });
      return;
    }
    const created = await users.create({
      id: newUserId(),
      email: email.toLowerCase(),
      name: name.trim(),
      passwordHash: await hashPassword(password, scryptCost),
      role: 'customer',
      walletAddress: newWalletAddress(),
    });
    if (!created) {
      res.status(409).json({ error: 'email already registered' });
      return;
    }
    res.status(201).json(await issueTokens(created));
  });

  app.post('/api/auth/refresh', async (req, res) => {
    const { refreshToken } = req.body ?? {};
    const denied = () => res.status(401).json({ error: 'log in again' });
    if (!isString(refreshToken)) return void denied();

    const { status, row } = await users.consumeRefresh(sha256(refreshToken));
    if (status === 'spent' && row) {
      // reuse means someone copied the token. nobody can tell which side is the real one
      await users.revokeFamily(row.family);
      return void denied();
    }
    if (status !== 'ok' || !row || row.expiresAt < now()) return void denied();
    const user = await users.findById(row.userId);
    if (!user) return void denied();
    res.json(await issueTokens(user, row.family));
  });

  app.post('/api/auth/logout', async (req, res) => {
    const { refreshToken } = req.body ?? {};
    if (isString(refreshToken)) {
      const { row } = await users.consumeRefresh(sha256(refreshToken));
      if (row) await users.revokeFamily(row.family);
    }
    res.status(204).end();
  });

  app.get('/api/auth/me', async (req, res) => {
    const found = await userFromToken(bearer(req));
    if (!found) {
      res.status(401).json({ error: 'not logged in' });
      return;
    }
    const { id, name, email, role, walletAddress } = found.user;
    res.json({ id, name, email, role, walletAddress });
  });

  // chapter 10.3, right to be forgotten
  app.delete('/api/auth/me', async (req, res) => {
    const found = await userFromToken(bearer(req));
    if (!found) {
      res.status(401).json({ error: 'not logged in' });
      return;
    }
    const { password } = req.body ?? {};
    if (!isString(password) || !(await verifyPassword(password, found.user.passwordHash))) {
      res.status(401).json({ error: 'password required' });
      return;
    }
    await users.remove(found.user.id);
    res.status(204).end();
  });

  // ---- reachable from inside the stack only, the gateway has no route to these ----

  // nginx auth_request calls this for every protected request
  app.get('/internal/verify', async (req, res) => {
    const found = await userFromToken(bearer(req) ?? tokenFromOriginalUri(req));
    if (!found) {
      res.status(401).end();
      return;
    }
    if (req.query.role && req.query.role !== found.user.role) {
      res.status(403).end();
      return;
    }
    res.set({ 'X-User-Id': found.user.id, 'X-User-Role': found.user.role, 'X-Token-Exp': String(found.exp) }).status(204).end();
  });

  app.get('/internal/users/:id', async (req, res) => {
    const user = await users.findById(req.params.id);
    if (!user) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(internalUser(user));
  });

  app.get('/internal/customers', async (_req, res) => {
    res.json((await users.listCustomers()).map(internalUser));
  });

  // malformed json and the like end up here. details stay in the log
  app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status && err.status < 500 ? err.status : 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 500 ? 'internal error' : 'bad request' });
  });

  return app;
}
