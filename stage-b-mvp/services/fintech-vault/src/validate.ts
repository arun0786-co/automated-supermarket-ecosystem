import { ethers } from 'ethers';

// amounts come in as SPMT strings or numbers ("12.50"), must be positive
export function parseAmount(value: unknown): bigint | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  try {
    const wei = ethers.parseUnits(String(value), 18);
    return wei > 0n ? wei : null;
  } catch {
    return null;
  }
}

export function isAddress(value: unknown): value is string {
  return typeof value === 'string' && ethers.isAddress(value);
}
