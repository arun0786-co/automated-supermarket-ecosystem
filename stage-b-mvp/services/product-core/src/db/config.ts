import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';

// docker compose passes DATABASE_URL. outside docker the DB_* vars or local defaults are used
export const dbOptions: PostgresConnectionOptions = process.env.DATABASE_URL
  ? { type: 'postgres', url: process.env.DATABASE_URL }
  : {
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      username: process.env.DB_USER || 'ase',
      password: process.env.DB_PASS,
      database: process.env.DB_NAME || 'ase_products',
    };
