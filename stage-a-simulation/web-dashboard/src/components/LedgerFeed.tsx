'use client';

import { Blocks, CheckCircle, XCircle } from 'lucide-react';
import type { CheckoutEvent } from '@/app/page';

type Props = { checkouts: CheckoutEvent[] };

export default function LedgerFeed({ checkouts }: Props) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-sm flex flex-col overflow-hidden h-full">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-800 shrink-0">
        <Blocks size={15} className="text-violet-400" />
        <h2 className="font-semibold text-sm text-white">Blockchain Ledger</h2>
        <span className="ml-auto text-[10px] bg-violet-500/15 text-violet-400 px-2 py-0.5 rounded-full">Service C</span>
      </div>

      <div className="overflow-y-auto flex-1 divide-y divide-slate-800/60" style={{ maxHeight: 260 }}>
        {checkouts.length === 0 ? (
          <p className="text-slate-500 text-xs p-4 text-center">No transactions yet…</p>
        ) : (
          checkouts.map((c, i) => (
            <div key={i} className="px-4 py-2.5 hover:bg-slate-800/40 transition-colors">
              <div className="flex items-center gap-2 mb-0.5">
                {c.ok
                  ? <CheckCircle size={12} className="text-emerald-400 shrink-0" />
                  : <XCircle size={12} className="text-rose-400 shrink-0" />}
                <span className="text-xs font-semibold text-white tabular-nums">
                  {c.ok ? '−' : ''}{c.total.toFixed(2)} SPMT
                </span>
                <span className="text-[10px] text-slate-400 ml-auto">{c.ts}</span>
              </div>
              <p className="text-[10px] text-slate-500 font-mono truncate">
                {c.hash || c.reason || 'rejected'}
              </p>
              <p className="text-[10px] text-slate-500">
                {c.trolleyId} · {c.itemCount} items · {c.userId}
                {c.overdraftUsed ? <span className="text-amber-400"> · overdraft {c.overdraftUsed.toFixed(2)}</span> : null}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
