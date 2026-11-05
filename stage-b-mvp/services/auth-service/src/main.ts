import { Pool } from 'pg';
import { createApp } from './app';
import { hashPassword } from './passwords';
import { PostgresUsers, Role } from './users';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`set ${name}`);
  return value;
}

// same three demo customers as stage A, on the hardhat accounts the vault funds at deploy
const DEMO_CUSTOMERS = [
  { id: 'USR-001', email: 'arun@ase.local', name: 'Arun K.', walletAddress: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' },
  { id: 'USR-002', email: 'priya@ase.local', name: 'Priya M.', walletAddress: '0x90F79bf6EB2c4f870365E785982E1f101E93b906' },
  { id: 'USR-003', email: 'rohan@ase.local', name: 'Rohan S.', walletAddress: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65' },
];

async function seed(users: PostgresUsers) {
  if (!(await users.claimFirstSeed())) return;
  const customerHash = await hashPassword(required('DEMO_PASSWORD'));
  for (const customer of DEMO_CUSTOMERS) {
    await users.create({ ...customer, passwordHash: customerHash, role: 'customer' as Role });
  }
  await users.create({
    id: 'ADM-001',
    email: 'admin@ase.local',
    name: 'Store Admin',
    passwordHash: await hashPassword(required('ADMIN_PASSWORD')),
    role: 'admin',
    walletAddress: '0x0000000000000000000000000000000000000000',
  });
  console.log(`seeded ${DEMO_CUSTOMERS.length} demo customers and an admin`);
}

async function main() {
  const jwtSecret = required('JWT_SECRET');
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');

  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'ase',
    password: required('DB_PASS'),
    database: process.env.DB_NAME || 'ase_products',
  });
  // the pool emits this when an idle connection drops. it reconnects by itself
  pool.on('error', (err) => console.warn(`postgres connection lost: ${err.message}`));

  const users = new PostgresUsers(pool);
  await users.migrate();
  await seed(users);

  const port = Number(process.env.PORT || 3004);
  createApp({ users, jwtSecret }).listen(port, () => console.log(`auth-service on port ${port}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
