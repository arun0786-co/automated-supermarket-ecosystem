'use client';

import { Wallet, TrendingUp, Hash } from 'lucide-react';

type Props = { userId: string; name: string; balance: number; lastHash: string };

export default function WalletCard({ userId, name, balance, lastHash }: Props) {
  const isNegative = balance < 0;

  return (
    <div className={`rounded-2xl border p-5 flex flex-col gap-4 hover:border-slate-600 transition-colors
      ${isNegative
        ? 'border-rose-800/60 bg-gradient-to-br from-rose-950/50 to-slate-900'
        : 'border-slate-800 bg-gradient-to-br from-slate-900 to-slate-800/60'}`}>

      {/* header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-xs font-bold text-white shrink-0">
            {name[0]}
          </div>
          <div>
            <p className="text-sm font-semibold text-white">{name}</p>
            <p className="text-xs text-slate-500 font-mono">{userId}</p>
          </div>
        </div>
        <Wallet size={15} className="text-violet-400 shrink-0" />
      </div>

      {/* balance */}
      <div>
        <p className="text-[10px] text-slate-400 uppercase tracking-widest font-medium mb-0.5">$SPMT Balance</p>
        <p className={`text-2xl font-bold tabular-nums ${isNegative ? 'text-rose-400' : 'text-white'}`}>
          {balance.toFixed(2)}
          <span className="text-sm text-slate-400 font-normal ml-1">SPMT</span>
        </p>
        {isNegative && (
          <p className="text-[10px] text-rose-400 mt-0.5">Overdraft active</p>
        )}
      </div>

      {/* last block */}
      <div className="flex items-center justify-between pt-3 border-t border-slate-700/50">
        <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
          <Hash size={10} />
          <span className="font-mono truncate max-w-[100px]">{lastHash}</span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-emerald-400">
          <TrendingUp size={10} />
          <span>Active</span>
        </div>
      </div>
    </div>
  );
}
