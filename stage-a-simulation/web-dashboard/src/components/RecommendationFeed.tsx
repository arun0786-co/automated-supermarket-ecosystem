'use client';

import { Sparkles } from 'lucide-react';
import type { ScanEvent } from '@/app/page';
import { useMemo } from 'react';

// maps the last scanned product name to contextual suggestions (simulates Service D collaborative filtering)
const RECS: Record<string, { item: string; reason: string; emoji: string }[]> = {
  'Cereal Box':  [{ item: 'Whole Milk 1L',    reason: 'Goes well with cereal',        emoji: '🥛' }, { item: 'Bananas',        reason: 'Quick breakfast pairing',         emoji: '🍌' }],
  'Banana':      [{ item: 'Greek Yogurt',      reason: 'Popular combo',                emoji: '🫙' }, { item: 'Granola 500g',   reason: 'Users who bought bananas…',       emoji: '🥣' }],
  'Almond Milk': [{ item: 'Oat Cookies',       reason: 'Dairy-free match',             emoji: '🍪' }, { item: 'Protein Bar',    reason: 'Popular in health aisle',        emoji: '🍫' }],
  'Pasta 500g':  [{ item: 'Olive Oil 500ml',   reason: 'Essential pairing',            emoji: '🫙' }, { item: 'Basil',          reason: 'You have pasta + oil in cart',    emoji: '🌿' }],
  'Chicken Breast': [{ item: 'Olive Oil 500ml', reason: 'Cooking essential',           emoji: '🫙' }, { item: 'Garlic',         reason: 'Top pairing in your aisle',      emoji: '🧄' }],
  'default':     [{ item: 'Sparkling Water',   reason: 'Top seller today',             emoji: '💧' }, { item: 'Dark Chocolate', reason: 'Trending in your area',           emoji: '🍫' }],
};

type Props = { scanEvents: ScanEvent[] };

export default function RecommendationFeed({ scanEvents }: Props) {
  const recs = useMemo(() => {
    if (scanEvents.length === 0) return RECS['default'];
    // use the product name from the CartItem (replaces old 'class' field)
    const latestName = scanEvents[0].event.name;
    return RECS[latestName] || RECS['default'];
  }, [scanEvents]);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-sm overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-800">
        <Sparkles size={15} className="text-amber-400" />
        <h2 className="font-semibold text-sm text-white">AI Recommendations</h2>
        <span className="ml-auto text-[10px] bg-amber-500/15 text-amber-400 px-2 py-0.5 rounded-full">Service D</span>
      </div>
      <div className="p-3 space-y-2">
        {recs.map((r, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-xl bg-slate-800/40 hover:bg-slate-800/70 transition-colors px-3 py-2.5 cursor-pointer"
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500/30 to-orange-500/20 border border-amber-500/20 flex items-center justify-center text-base shrink-0">
              {r.emoji}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-white font-medium truncate">{r.item}</p>
              <p className="text-xs text-slate-400 truncate">{r.reason}</p>
            </div>
            <button className="ml-auto text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-2 py-1 rounded-lg transition-colors shrink-0">
              Add
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
