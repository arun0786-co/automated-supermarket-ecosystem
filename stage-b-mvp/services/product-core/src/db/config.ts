import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';

// no default password in code, fail with a clear message instead of a postgres auth error
function requirePassword(): string {
  if (!process.env.DB_PASS) throw new Error('set DATABASE_URL or DB_PASS for the product database');
  return process.env.DB_PASS;
}

// DATABASE_URL wins if set, otherwise the DB_* vars (docker compose passes DB_HOST and DB_PASS)
export const dbOptions: PostgresConnectionOptions = process.env.DATABASE_URL
  ? { type: 'postgres', url: process.env.DATABASE_URL }
  : {
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      username: process.env.DB_USER || 'ase',
      password: requirePassword(),
      database: process.env.DB_NAME || 'ase_products',
    };
