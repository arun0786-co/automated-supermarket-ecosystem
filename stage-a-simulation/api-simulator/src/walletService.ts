import crypto from 'crypto';

// this file simulates Service C from the spec (chapter 6)
// in stage b this gets replaced by actual Solidity contracts on a Hyperledger Besu node
// for now SHA256 gives us real-looking block hashes without needing an actual chain

export type WalletEntry = {
  userId: string;
  name: string;
  balance: number;       // in $SPMT, pegged 1:1 to local fiat
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

// hardcoded wallets for now — stage b will pull these from postgres
const wallets: Map<string, WalletEntry> = new Map([
  ['USR-001', { userId: 'USR-001', name: 'Arun K.',  balance: 105.50, overdraftLimit: -20, isSubscriber: true  }],
  ['USR-002', { userId: 'USR-002', name: 'Priya M.', balance: 62.00,  overdraftLimit: -10, isSubscriber: false }],
  ['USR-003', { userId: 'USR-003', name: 'Rohan S.', balance: 210.75, overdraftLimit: -50, isSubscriber: true  }],
]);

// start at block 10,000 so it looks like a chain with some history
let blockNumber = 10_000;
const ledger: TxRecord[] = [];

function mineBlock(): string {
  blockNumber++;
  // deterministic hash based on block number + time
  // in production: actual keccak256 from the EVM
  return '0x' + crypto
    .createHash('sha256')
    .update(`${blockNumber}-${Date.now()}`)
    .digest('hex')
    .slice(0, 40);
}

export function getWallet(userId: string): WalletEntry | null {
  return wallets.get(userId) || null;
}

export function getAllWallets(): WalletEntry[] {
  return Array.from(wallets.values());
}

// this is the "Limited Overdraft" smart contract from chapter 6 of the spec
// the real Solidity version does the same thing, just on-chain with gas
export function checkout(userId: string, amount: number): { ok: boolean; hash?: string; reason?: string } {
  const wallet = wallets.get(userId);
  if (!wallet) return { ok: false, reason: 'wallet not found' };

  const projected = wallet.balance - amount;

  if (wallet.balance >= amount) {
    // normal case — enough funds
    wallet.balance = +projected.toFixed(2);
    const hash = mineBlock();
    ledger.push({
      hash,
      blockNumber,
      from: userId,
      to: 'STORE_WALLET',
      amount,
      timestamp: new Date().toISOString(),
      type: 'PURCHASE',
    });
    return { ok: true, hash };

  } else if (wallet.isSubscriber && projected >= wallet.overdraftLimit) {
    // subscriber perk — allow negative balance up to the limit
    // fiat recovery gets triggered in the background (triggerFiatRecovery in the spec)
    wallet.balance = +projected.toFixed(2);
    const hash = mineBlock();
    ledger.push({
      hash,
      blockNumber,
      from: userId,
      to: 'STORE_WALLET',
      amount,
      timestamp: new Date().toISOString(),
      type: 'OVERDRAFT_RECOVERY',
    });
    return { ok: true, hash };

  } else {
    // not enough funds and either not a subscriber or overdraft limit hit
    return { ok: false, reason: 'insufficient funds' };
  }
}

export function getLedger(limit = 20): TxRecord[] {
  return ledger.slice(-limit).reverse();
}

export function getBlockHeight(): number {
  return blockNumber;
}
