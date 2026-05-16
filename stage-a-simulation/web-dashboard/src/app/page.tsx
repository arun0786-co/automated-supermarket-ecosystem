'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import StoreMap from '@/components/StoreMap';
import ScanFeed from '@/components/ScanFeed';
import WalletCard from '@/components/WalletCard';
import MetricsBar from '@/components/MetricsBar';
import Sidebar from '@/components/Sidebar';
import RecommendationFeed from '@/components/RecommendationFeed';
import LedgerFeed from '@/components/LedgerFeed';

export type Trolley = {
  id: string;
  userId: string;
  x: number;
  y: number;
  status: 'IDLE' | 'SHOPPING' | 'CHECKOUT';
  cartItems: CartItem[];
  totalWeight: number;
  cartTotal: number;
};

export type CartItem = {
  sku: string;
  name: string;
  confidence: number;
  weightDelta: number;
  price: number;
  discounted: boolean;
  ts: string;
};

export type ScanEvent = {
  trolleyId: string;
  userId: string;
  event: CartItem & { accepted: boolean };
  ts: string;
};

export type CheckoutEvent = {
  trolleyId: string;
  userId: string;
  total: number;
  itemCount: number;
  ok: boolean;
  hash?: string;
  reason?: string;
  ts: string;
};

export type WalletState = {
  [userId: string]: {
    balance: number;
    lastHash: string;
  };
};

export default function Dashboard() {
  const ws = useRef<WebSocket | null>(null);
  const [trolleys, setTrolleys] = useState<Trolley[]>([]);
  const [scanEvents, setScanEvents] = useState<ScanEvent[]>([]);
  const [checkouts, setCheckouts] = useState<CheckoutEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [txCount, setTxCount] = useState(0);

  // wallet balances — updated on checkout events
  const [wallets, setWallets] = useState<WalletState>({
    'USR-001': { balance: 105.50, lastHash: '0x0000000' },
    'USR-002': { balance: 62.00,  lastHash: '0x0000000' },
    'USR-003': { balance: 210.75, lastHash: '0x0000000' },
  });

  const fetchWallets = useCallback(async () => {
    try {
      const res = await fetch('http://localhost:3001/api/wallets');
      const data = await res.json();
      setWallets((prev) => {
        const next = { ...prev };
        data.forEach((w: { userId: string; balance: number }) => {
          next[w.userId] = { ...(prev[w.userId] || {}), balance: w.balance, lastHash: prev[w.userId]?.lastHash ?? '0x000' };
        });
        return next;
      });
    } catch { /* not connected yet */ }
  }, []);

  useEffect(() => {
    fetchWallets();

    const connect = () => {
      ws.current = new WebSocket('ws://localhost:3001');

      ws.current.onopen = () => setConnected(true);
      ws.current.onclose = () => {
        setConnected(false);
        setTimeout(connect, 3000);
      };

      ws.current.onmessage = (evt) => {
        const msg = JSON.parse(evt.data);

        if (msg.type === 'TROLLEY_POSITIONS') {
          setTrolleys(msg.data);
        }

        if (msg.type === 'SCAN_EVENT') {
          setTxCount((c) => c + 1);
          setScanEvents((prev) =>
            [{ ...msg, ts: new Date().toLocaleTimeString() }, ...prev].slice(0, 40)
          );
        }

        if (msg.type === 'CHECKOUT_EVENT') {
          const ev: CheckoutEvent = { ...msg, ts: new Date().toLocaleTimeString() };
          setCheckouts((prev) => [ev, ...prev].slice(0, 20));

          if (msg.ok && msg.hash) {
            setWallets((prev) => ({
              ...prev,
              [msg.userId]: {
                balance: prev[msg.userId]?.balance - msg.total,
                lastHash: msg.hash,
              },
            }));
          }
          // re-sync wallet from server after checkout
          fetchWallets();
        }
      };
    };

    connect();
    return () => ws.current?.close();
  }, [fetchWallets]);

  const walletList = [
    { userId: 'USR-001', name: 'Arun K.' },
    { userId: 'USR-002', name: 'Priya M.' },
    { userId: 'USR-003', name: 'Rohan S.' },
  ];

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />

      <main className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">ASE-PRIME Fleet Command</h1>
            <p className="text-slate-400 text-sm mt-0.5">Stage A · Simulation Engine · 5 virtual trolleys</p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className={`w-2 h-2 rounded-full animate-pulse ${connected ? 'bg-emerald-400' : 'bg-rose-500'}`} />
            <span className={connected ? 'text-emerald-400' : 'text-rose-400'}>
              {connected ? 'Fleet Connected' : 'Reconnecting…'}
            </span>
          </div>
        </div>

        <MetricsBar trolleys={trolleys} txCount={txCount} checkoutCount={checkouts.length} />

        {/* main grid */}
        <div className="grid grid-cols-12 gap-5">
          <div className="col-span-12 lg:col-span-7">
            <StoreMap trolleys={trolleys} />
          </div>
          <div className="col-span-12 lg:col-span-5 flex flex-col gap-5">
            <ScanFeed events={scanEvents} />
            <RecommendationFeed scanEvents={scanEvents} />
          </div>
        </div>

        {/* wallets + ledger */}
        <div className="grid grid-cols-12 gap-5">
          <div className="col-span-12 lg:col-span-8 grid grid-cols-1 sm:grid-cols-3 gap-5">
            {walletList.map((w) => (
              <WalletCard
                key={w.userId}
                userId={w.userId}
                name={w.name}
                balance={wallets[w.userId]?.balance ?? 0}
                lastHash={wallets[w.userId]?.lastHash ?? '0x000'}
              />
            ))}
          </div>
          <div className="col-span-12 lg:col-span-4">
            <LedgerFeed checkouts={checkouts} />
          </div>
        </div>
      </main>
    </div>
  );
}
