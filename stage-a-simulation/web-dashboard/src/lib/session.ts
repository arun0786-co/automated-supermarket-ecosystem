// the logged in session against the stage B gateway. kept free of react so it can be tested

export type SessionUser = { id: string; name: string; role: string };

type TokenResponse = { accessToken: string; refreshToken: string; expiresIn: number; user: SessionUser };

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type SessionDeps = {
  base: string;
  fetch: typeof fetch;
  storage: StorageLike;
  onExpired: () => void;
  now?: () => number;
};

const REFRESH_KEY = 'ase.refreshToken';
// refresh a little early, so a token doesn't expire on its way to the server
const EXPIRY_MARGIN_MS = 30_000;

export class Session {
  user: SessionUser | null = null;
  private accessToken: string | null = null;
  private expiresAt = 0;
  // a refresh token works once and reuse revokes the session, so concurrent callers share one
  private refreshing: Promise<string | null> | null = null;
  private readonly deps: SessionDeps;
  private readonly now: () => number;

  constructor(deps: SessionDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  private adopt(tokens: TokenResponse) {
    this.user = tokens.user;
    this.accessToken = tokens.accessToken;
    this.expiresAt = this.now() + tokens.expiresIn * 1000;
    // the access token stays in memory. only what's needed to survive a reload is stored
    this.deps.storage.setItem(REFRESH_KEY, tokens.refreshToken);
  }

  private clear() {
    this.user = null;
    this.accessToken = null;
    this.expiresAt = 0;
    this.deps.storage.removeItem(REFRESH_KEY);
  }

  private post(path: string, body: unknown) {
    return this.deps.fetch(`${this.deps.base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async login(email: string, password: string): Promise<void> {
    let res: Response;
    try {
      res = await this.post('/api/auth/login', { email, password });
    } catch {
      throw new Error('Could not reach the server');
    }
    if (res.status === 429) throw new Error('Too many attempts, wait a minute and try again');
    if (!res.ok) throw new Error('Invalid email or password');
    this.adopt((await res.json()) as TokenResponse);
  }

  private refresh(): Promise<string | null> {
    if (!this.refreshing) {
      this.refreshing = this.runRefresh().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async runRefresh(): Promise<string | null> {
    const refreshToken = this.deps.storage.getItem(REFRESH_KEY);
    if (!refreshToken) return null;
    let res: Response;
    try {
      res = await this.post('/api/auth/refresh', { refreshToken });
    } catch {
      // a network blip isn't a logout. try again on the next call
      return null;
    }
    if (!res.ok) {
      this.clear();
      this.deps.onExpired();
      return null;
    }
    this.adopt((await res.json()) as TokenResponse);
    return this.accessToken;
  }

  // on page load: true if a stored session is still good
  async restore(): Promise<boolean> {
    if (!this.deps.storage.getItem(REFRESH_KEY)) return false;
    return (await this.refresh()) !== null;
  }

  async token(): Promise<string | null> {
    if (this.accessToken && this.now() < this.expiresAt - EXPIRY_MARGIN_MS) return this.accessToken;
    return this.refresh();
  }

  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const send = (token: string | null) =>
      this.deps.fetch(`${this.deps.base}${path}`, {
        ...init,
        headers: { ...init.headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      });

    const res = await send(await this.token());
    if (res.status !== 401) return res;

    // the server has stopped accepting this token, even if it hasn't timed out here
    this.accessToken = null;
    const fresh = await this.refresh();
    if (!fresh) return res;
    const retried = await send(fresh);
    if (retried.status === 401) {
      this.clear();
      this.deps.onExpired();
    }
    return retried;
  }

  async logout(): Promise<void> {
    const refreshToken = this.deps.storage.getItem(REFRESH_KEY);
    this.clear();
    if (refreshToken) await this.post('/api/auth/logout', { refreshToken }).catch(() => {});
  }
}
