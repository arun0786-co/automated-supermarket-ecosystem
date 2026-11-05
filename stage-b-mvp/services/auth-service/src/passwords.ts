import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_LENGTH = 32;
export const DEFAULT_COST = 2 ** 15;

function derive(password: string, salt: Buffer, cost: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // maxmem has to cover 128 * cost * block size, the default is too small at this cost
    scrypt(password, salt, KEY_LENGTH, { N: cost, r: BLOCK_SIZE, p: PARALLELISM, maxmem: 256 * cost * BLOCK_SIZE }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

// the cost is stored with the hash, so it can be raised later without breaking old passwords
export async function hashPassword(password: string, cost = DEFAULT_COST): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${cost}$${salt.toString('base64url')}$${(await derive(password, salt, cost)).toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, cost, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !cost || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = await derive(password, Buffer.from(salt, 'base64url'), Number(cost));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
