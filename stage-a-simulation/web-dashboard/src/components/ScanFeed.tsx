'use client';

import type { ScanEvent } from '@/app/page';
import { ScanLine, CheckCircle, XCircle } from 'lucide-react';

type Props = { events: ScanEvent[] };

export default function ScanFeed({ events }: Props) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-sm flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-2">
          <ScanLine size={16} className="text-cyan-400" />
          <h2 className="font-semibold text-sm text-white">Vision Scan Feed</h2>
        </div>
        <span className="text-xs text-slate-400 tabular-nums">{events.length} events</span>
      </div>

      <div className="overflow-y-auto flex-1 divide-y divide-slate-800/60" style={{ maxHeight: 280 }}>
        {events.length === 0 ? (
          <p className="text-slate-500 text-xs p-4 text-center">Waiting for trolley events…</p>
        ) : (
          events.map((e, i) => {
            // confidence is already a number from the updated CartItem type
            const conf = e.event.confidence;
            const ok = conf >= 0.80;
            return (
              <div
                key={i}
                className="flex items-start gap-3 px-4 py-2.5 hover:bg-slate-800/40 transition-colors"
                style={{ animation: i === 0 ? 'fadeIn 0.3s ease' : undefined }}
              >
                {ok
                  ? <CheckCircle size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                  : <XCircle size={14} className="text-rose-400 shrink-0 mt-0.5" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-100 font-medium truncate">{e.event.name}</p>
                  <p className="text-xs text-slate-400">
                    {e.trolleyId} · {e.event.weightDelta.toFixed(0)}g · {e.ts}
                  </p>
                </div>
                <span
                  className={`text-xs font-mono font-semibold px-1.5 py-0.5 rounded-md shrink-0 ${
                    ok ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'
                  }`}
                >
                  {(conf * 100).toFixed(0)}%
                </span>
              </div>
            );
          })
        )}
      </div>

      <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}`}</style>
    </div>
  );
}
