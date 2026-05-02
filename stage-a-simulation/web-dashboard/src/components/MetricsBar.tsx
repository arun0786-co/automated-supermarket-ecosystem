'use client';

import { ShoppingCart, Zap, Activity, Users, AlertTriangle } from 'lucide-react';
import type { Trolley } from '@/app/page';

type Props = { trolleys: Trolley[]; txCount: number; checkoutCount: number };

export default function MetricsBar({ trolleys, txCount, checkoutCount }: Props) {
  const active    = trolleys.filter((t) => t.status === 'SHOPPING').length;
  const checkout  = trolleys.filter((t) => t.status === 'CHECKOUT').length;
  const totalWeight = trolleys.reduce((s, t) => s + t.totalWeight, 0);

  const metrics = [
    { icon: ShoppingCart, label: 'Shopping',     value: active,                   color: 'text-cyan-400',   bg: 'bg-cyan-500/10   border-cyan-500/20' },
    { icon: Zap,          label: 'Items Scanned', value: txCount,                   color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20' },
    { icon: Activity,     label: 'Checkouts',    value: checkoutCount,              color: 'text-emerald-400',bg: 'bg-emerald-500/10 border-emerald-500/20' },
    { icon: Users,        label: 'Checking Out', value: checkout,                  color: 'text-amber-400',  bg: 'bg-amber-500/10  border-amber-500/20' },
    { icon: AlertTriangle,label: 'Kg in Carts',  value: (totalWeight / 1000).toFixed(1), color: 'text-rose-400', bg: 'bg-rose-500/10 border-rose-500/20' },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {metrics.map(({ icon: Icon, label, value, color, bg }) => (
        <div key={label} className={`rounded-xl border p-4 ${bg} flex items-center gap-3`}>
          <div className="p-2 rounded-lg bg-slate-900/50 shrink-0">
            <Icon size={18} className={color} />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-slate-400 font-medium truncate">{label}</p>
            <p className={`text-xl font-bold ${color} tabular-nums`}>{value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
