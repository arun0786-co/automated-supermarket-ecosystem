'use client';

import { Sparkles } from 'lucide-react';
import type { ScanEvent } from '@/app/page';
import { useMemo } from 'react';

// last accepted sku -> suggestions, all real catalog items. the pairs mirror the
// co-purchase matrix in stage-b-mvp/services/ai-engine (service D)
type Rec = { item: string; reason: string; emoji: string };
const RECS: Record<string, Rec[]> = {
  'PRD-001': [{ item: 'Greek Yogurt',    reason: 'Commonly bought together', emoji: '🫙' }, { item: 'Cereal Box',      reason: 'Popular breakfast combo',  emoji: '🥣' }],
  'PRD-004': [{ item: 'Olive Oil 500ml', reason: 'Avocado toast essential',  emoji: '🫙' }, { item: 'Sourdough Loaf',  reason: 'Avocado toast essential',  emoji: '🍞' }],
  'DRY-001': [{ item: 'Cereal Box',      reason: 'Milk goes with cereal',    emoji: '🥣' }, { item: 'White Bread',     reason: 'Classic combo',            emoji: '🍞' }],
  'DRY-002': [{ item: 'Granola 500g',    reason: 'Almond milk + granola',    emoji: '🥣' }, { item: 'Green Tea 25s',   reason: 'Health aisle pairing',     emoji: '🍵' }],
  'BKR-001': [{ item: 'Full Cream Milk', reason: 'Bread and milk',           emoji: '🥛' }, { item: 'Peanut Butter',   reason: 'Peanut butter toast',      emoji: '🫙' }],
  'PNT-001': [{ item: 'Full Cream Milk', reason: 'Cereal and milk',          emoji: '🥛' }, { item: 'Banana',          reason: 'Fruit with cereal',        emoji: '🍌' }],
  'PNT-002': [{ item: 'Olive Oil 500ml', reason: 'Pasta and olive oil',      emoji: '🫙' }, { item: 'Chicken Breast',  reason: 'Chicken pasta',            emoji: '🍗' }],
  'BVG-003': [{ item: 'Croissant x2',    reason: 'Morning coffee set',       emoji: '🥐' }, { item: 'Dark Chocolate',  reason: 'Coffee and chocolate',     emoji: '🍫' }],
  'MTF-001': [{ item: 'Olive Oil 500ml', reason: 'Cooking essential',        emoji: '🫙' }, { item: 'Tomato',          reason: 'Chicken and tomato',       emoji: '🍅' }],
  'MTF-002': [{ item: 'Olive Oil 500ml', reason: 'Salmon cooking essential', emoji: '🫙' }, { item: 'Orange',          reason: 'Salmon and citrus',        emoji: '🍊' }],
};
// trending fallback when there's no scan yet or no pairing for the sku
const TRENDING: Rec[] = [
  { item: 'Sparkling Water', reason: 'Top seller this week',  emoji: '💧' },
  { item: 'Dark Chocolate',  reason: 'Trending in your area', emoji: '🍫' },
];

type Props = { scanEvents: ScanEvent[] };

export default function RecommendationFeed({ scanEvents }: Props) {
  const recs = useMemo(() => {
    // newest accepted scan that has pairings. rejected scans never reached the cart
    const latest = scanEvents.find((e) => e.event.accepted && RECS[e.event.sku]);
    return latest ? RECS[latest.event.sku] : TRENDING;
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
            className="flex items-center gap-3 rounded-xl bg-slate-800/40 hover:bg-slate-800/70 transition-colors px-3 py-2.5"
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500/30 to-orange-500/20 border border-amber-500/20 flex items-center justify-center text-base shrink-0">
              {r.emoji}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-white font-medium truncate">{r.item}</p>
              <p className="text-xs text-slate-400 truncate">{r.reason}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
