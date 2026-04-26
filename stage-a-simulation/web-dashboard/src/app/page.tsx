'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import StoreMap from '@/components/StoreMap';
import ScanFeed from '@/components/ScanFeed';
import WalletCard from '@/components/WalletCard';
import MetricsBar from '@/components/MetricsBar';
import Sidebar from '@/components/Sidebar';
import RecommendationFeed from '@/components/RecommendationFeed';
import LedgerFeed from '@/components/LedgerFeed';
import { SIM_HTTP, SIM_WS } from '@/lib/config';

export type Trolley = {
  id: string;
  userId: string;
  x: number;
  y: number;
  status: 'IDLE' | 'SHOPPING' | 'CHECKOUT';
  cartItems: CartItem[]; // last 3 only, see itemCount for the full size
  itemCount: number;
  totalWeight: number;
  cartTotal: number;
};

export type CartItem = {
  sku: string;
  name: string;
  emoji: string;
  confidence: number;
  weightDelta: number;
  price: number;
  discounted: boolean;
  ts: string;
};

export type ScanEvent = {
  trolleyId: string;
  userId: string;
  event: CartItem & { accepted: boolean; reason?: string };
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
  overdraftUsed?: number;
  ts: string;
};

export type Wallet = {
  userId: string;
  name: string;
  balance: number;
  lastHash: string;
};

export default function Dashboard() {
  const ws = useRef<WebSocket | null>(null);
  const [trolleys, setTrolleys] = useState<Trolley[]>([]);
  const [scanEvents, setScanEvents] = useState<ScanEvent[]>([]);
  const [checkouts, setCheckouts] = useState<CheckoutEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [txCount, setTxCount] = useState(0);

  // wallet list and balances come from the simulator, last block hash from checkout events
  const [wallets, setWallets] = useState<Wallet[]>([]);

  // re-sync balances from the server, the source of truth for the mock ledger
  const fetchWallets = useCallback(() => {
    fetch(`${SIM_HTTP}/api/wallets`)
      .then((res) => res.json())
      .then((data: { userId: string; name: string; balance: number }[]) => {
        setWallets((prev) =>
          data.map((w) => ({
            userId: w.userId,
            name: w.name,
            balance: w.balance,
            lastHash: prev.find((p) => p.userId === w.userId)?.lastHash ?? '-',
          }))
        );
      })
      .catch(() => { /* simulator not up yet, the websocket retry will catch it */ });
  }, []);

  useEffect(() => {
    // set on unmount so the onclose handler doesn't schedule a reconnect
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const socket = new WebSocket(SIM_WS);
      ws.current = socket;

      socket.onopen = () => {
        setConnected(true);
        fetchWallets();
      };
      socket.onclose = () => {
        setConnected(false);
        if (!stopped) retry = setTimeout(connect, 3000);
      };

      socket.onmessage = (evt) => {
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
            setWallets((prev) =>
              prev.map((w) => (w.userId === msg.userId ? { ...w, lastHash: msg.hash } : w))
            );
          }
          // the server has already debited the wallet, so fetch the real balance
          fetchWallets();
        }
      };
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      ws.current?.close();
    };
  }, [fetchWallets]);

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
            {wallets.map((w) => (
              <WalletCard key={w.userId} userId={w.userId} name={w.name} balance={w.balance} lastHash={w.lastHash} />
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
