import crypto from 'crypto';

// simulating service C (chapter 6) without an actual blockchain for now
// stage b will swap this out for real solidity contracts on a hardhat/besu node
// the SHA256 hashes look real enough for the dashboard

export type WalletEntry = {
  userId: string;
  name: string;
  balance: number;       // in $SPMT, 1:1 with local fiat
  overdraftLimit: number;
  isSubscriber: boolean;
};

export type TxRecord = {
  hash: string;
  blockNumber: number;
  from: string;
  to: string;
  amount: number;
  timestamp: string;
  type: 'PURCHASE' | 'TOPUP' | 'OVERDRAFT_RECOVERY';
};

// hardcoded wallets, moves into postgres in stage b
const wallets: Map<string, WalletEntry> = new Map([
  ['USR-001', { userId: 'USR-001', name: 'Arun K.',  balance: 105.50, overdraftLimit: -20, isSubscriber: true  }],
  ['USR-002', { userId: 'USR-002', name: 'Priya M.', balance: 62.00,  overdraftLimit: -10, isSubscriber: false }],
  ['USR-003', { userId: 'USR-003', name: 'Rohan S.', balance: 210.75, overdraftLimit: -50, isSubscriber: true  }],
]);

// start at block 10k so the ledger looks like it has some history
let blockNumber = 10_000;
const ledger: TxRecord[] = [];

function mineBlock(): string {
  blockNumber++;
  // sha256 gives us a realistic-looking hash without needing an actual EVM
  return '0x' + crypto.createHash('sha256').update(`${blockNumber}-${Date.now()}`).digest('hex').slice(0, 40);
}

export function getWallet(userId: string): WalletEntry | null {
  return wallets.get(userId) || null;
}

export function getAllWallets(): WalletEntry[] {
  return Array.from(wallets.values());
}

// "limited overdraft" contract logic from chapter 6 of the spec
// subscribers can go negative down to their overdraftLimit
// if they go below that, transaction gets rejected same as insufficient funds
export function checkout(userId: string, amount: number): { ok: boolean; hash?: string; reason?: string } {
  const wallet = wallets.get(userId);
  if (!wallet) return { ok: false, reason: 'wallet not found' };

  const projected = wallet.balance - amount;

  if (wallet.balance >= amount) {
    wallet.balance = +projected.toFixed(2);
    const hash = mineBlock();
    ledger.push({ hash, blockNumber, from: userId, to: 'STORE_WALLET', amount, timestamp: new Date().toISOString(), type: 'PURCHASE' });
    return { ok: true, hash };
  }

  if (wallet.isSubscriber && projected >= wallet.overdraftLimit) {
    // subscriber overdraft, balance goes negative, fiat recovery kicks in later
    wallet.balance = +projected.toFixed(2);
    const hash = mineBlock();
    ledger.push({ hash, blockNumber, from: userId, to: 'STORE_WALLET', amount, timestamp: new Date().toISOString(), type: 'OVERDRAFT_RECOVERY' });
    return { ok: true, hash };
  }

  return { ok: false, reason: 'insufficient funds' };
}

export function getLedger(limit = 20): TxRecord[] {
  return ledger.slice(-limit).reverse();
}

export function getBlockHeight(): number {
  return blockNumber;
}
