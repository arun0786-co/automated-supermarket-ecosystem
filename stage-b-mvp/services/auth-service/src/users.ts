import { Pool } from 'pg';

export type Role = 'customer' | 'admin';

export type User = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: Role;
  walletAddress: string;
};

export type RefreshRow = { hash: string; userId: string; family: string; expiresAt: number };

// spent: the token was already used, which is what a stolen token looks like
export type ConsumeResult = { status: 'ok' | 'spent' | 'unknown'; row?: RefreshRow };

export interface Users {
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  // null if the email is taken
  create(user: User): Promise<User | null>;
  listCustomers(): Promise<User[]>;
  remove(id: string): Promise<void>;
  storeRefresh(row: RefreshRow): Promise<void>;
  // atomic, so two requests with the same token can't both succeed
  consumeRefresh(hash: string): Promise<ConsumeResult>;
  revokeFamily(family: string): Promise<void>;
}

export class MemoryUsers implements Users {
  private users = new Map<string, User>();
  private refresh = new Map<string, RefreshRow & { spent: boolean }>();

  clear() {
    this.users.clear();
    this.refresh.clear();
  }

  // for proving that forgetting someone leaves nothing behind
  findStoredPersonalData(needle: string) {
    return [...this.users.values()].filter((u) => JSON.stringify(u).includes(needle));
  }

  async findByEmail(email: string) {
    return [...this.users.values()].find((u) => u.email === email) ?? null;
  }
  async findById(id: string) {
    return this.users.get(id) ?? null;
  }
  async create(user: User) {
    if (await this.findByEmail(user.email)) return null;
    this.users.set(user.id, user);
    return user;
  }
  async listCustomers() {
    return [...this.users.values()].filter((u) => u.role === 'customer');
  }
  async remove(id: string) {
    this.users.delete(id);
    for (const [hash, row] of this.refresh) if (row.userId === id) this.refresh.delete(hash);
  }
  async storeRefresh(row: RefreshRow) {
    this.refresh.set(row.hash, { ...row, spent: false });
  }
  async consumeRefresh(hash: string): Promise<ConsumeResult> {
    const row = this.refresh.get(hash);
    if (!row) return { status: 'unknown' };
    if (row.spent) return { status: 'spent', row };
    row.spent = true;
    return { status: 'ok', row };
  }
  async revokeFamily(family: string) {
    for (const [hash, row] of this.refresh) if (row.family === family) this.refresh.delete(hash);
  }
}

const fromRow = (row: Record<string, string>): User => ({
  id: row.id,
  email: row.email,
  name: row.name,
  passwordHash: row.password_hash,
  role: row.role as Role,
  walletAddress: row.wallet_address,
});

// chapter 10.3: this table is the off-chain mapping from a person to their on-chain address.
// deleting the row leaves the chain history anonymous
export class PostgresUsers implements Users {
  constructor(private readonly pool: Pool) {}

  async migrate() {
    await this.pool.query(`
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE IF NOT EXISTS auth.users (
        id text PRIMARY KEY,
        email text NOT NULL UNIQUE,
        name text NOT NULL,
        password_hash text NOT NULL,
        role text NOT NULL,
        wallet_address text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS auth.refresh_tokens (
        hash text PRIMARY KEY,
        user_id text NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        family text NOT NULL,
        expires_at bigint NOT NULL,
        spent boolean NOT NULL DEFAULT false
      );
      CREATE INDEX IF NOT EXISTS refresh_tokens_family ON auth.refresh_tokens (family);
      CREATE TABLE IF NOT EXISTS auth.meta (key text PRIMARY KEY);
    `);
  }

  // true only the first time, so a forgotten demo user doesn't come back on the next restart
  async claimFirstSeed(): Promise<boolean> {
    const result = await this.pool.query(`INSERT INTO auth.meta (key) VALUES ('seeded') ON CONFLICT DO NOTHING`);
    return result.rowCount === 1;
  }

  async findByEmail(email: string) {
    const { rows } = await this.pool.query('SELECT * FROM auth.users WHERE email = $1', [email]);
    return rows[0] ? fromRow(rows[0]) : null;
  }
  async findById(id: string) {
    const { rows } = await this.pool.query('SELECT * FROM auth.users WHERE id = $1', [id]);
    return rows[0] ? fromRow(rows[0]) : null;
  }
  async create(user: User) {
    const result = await this.pool.query(
      `INSERT INTO auth.users (id, email, name, password_hash, role, wallet_address)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
      [user.id, user.email, user.name, user.passwordHash, user.role, user.walletAddress],
    );
    return result.rowCount === 1 ? user : null;
  }
  async listCustomers() {
    const { rows } = await this.pool.query(`SELECT * FROM auth.users WHERE role = 'customer' ORDER BY id`);
    return rows.map(fromRow);
  }
  async remove(id: string) {
    await this.pool.query('DELETE FROM auth.users WHERE id = $1', [id]);
  }
  async storeRefresh(row: RefreshRow) {
    await this.pool.query('INSERT INTO auth.refresh_tokens (hash, user_id, family, expires_at) VALUES ($1, $2, $3, $4)', [row.hash, row.userId, row.family, row.expiresAt]);
  }
  async consumeRefresh(hash: string): Promise<ConsumeResult> {
    const { rows } = await this.pool.query(
      `WITH previous AS (SELECT * FROM auth.refresh_tokens WHERE hash = $1 FOR UPDATE),
            spend AS (UPDATE auth.refresh_tokens SET spent = true WHERE hash = $1)
       SELECT * FROM previous`,
      [hash],
    );
    if (!rows[0]) return { status: 'unknown' };
    const row: RefreshRow = { hash, userId: rows[0].user_id, family: rows[0].family, expiresAt: Number(rows[0].expires_at) };
    return { status: rows[0].spent ? 'spent' : 'ok', row };
  }
  async revokeFamily(family: string) {
    await this.pool.query('DELETE FROM auth.refresh_tokens WHERE family = $1', [family]);
  }
}
