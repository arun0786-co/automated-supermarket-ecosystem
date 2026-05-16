'use client';

import { useEffect, useRef } from 'react';
import type { Trolley } from '@/app/page';

type Props = { trolleys: Trolley[] };

// rough floor plan — i drew this by hand to match a typical small supermarket
// in stage C this will come from the SLAM map the trolley builds on first deployment
// for now it's enough to give the dashboard something useful to look at
const SHELVES = [
  { x: 60,  y: 80,  w: 80, h: 20, label: 'Bakery' },
  { x: 180, y: 80,  w: 80, h: 20, label: 'Dairy' },
  { x: 300, y: 80,  w: 80, h: 20, label: 'Produce' },
  { x: 420, y: 80,  w: 80, h: 20, label: 'Beverages' },
  { x: 60,  y: 160, w: 20, h: 120, label: '' },
  { x: 160, y: 160, w: 20, h: 120, label: '' },
  { x: 260, y: 160, w: 20, h: 120, label: '' },
  { x: 360, y: 160, w: 20, h: 120, label: '' },
  { x: 460, y: 160, w: 20, h: 120, label: '' },
  { x: 60,  y: 320, w: 450, h: 15, label: 'Checkout Lane' },
];

// give each trolley a distinct colour so they're easy to tell apart on the map
const TROLLEY_COLORS = ['#00f3ff', '#b026ff', '#00ff9f', '#ffd700', '#ff6b6b'];


export default function StoreMap({ trolleys }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;

    // clear
    ctx.clearRect(0, 0, W, H);

    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // shelves
    SHELVES.forEach((s) => {
      ctx.fillStyle = 'rgba(51, 65, 85, 0.8)';
      ctx.strokeStyle = 'rgba(148,163,184,0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(s.x, s.y, s.w, s.h, 4);
      ctx.fill();
      ctx.stroke();

      if (s.label) {
        ctx.fillStyle = 'rgba(148,163,184,0.7)';
        ctx.font = '9px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(s.label, s.x + s.w / 2, s.y + s.h / 2 + 3);
      }
    });

    // trolleys
    trolleys.forEach((t, i) => {
      const color = TROLLEY_COLORS[i % TROLLEY_COLORS.length];

      // glow ring
      const grad = ctx.createRadialGradient(t.x, t.y, 0, t.x, t.y, 18);
      grad.addColorStop(0, color + '66');
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(t.x, t.y, 18, 0, Math.PI * 2);
      ctx.fill();

      // dot
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(t.x, t.y, 6, 0, Math.PI * 2);
      ctx.fill();

      // id label
      ctx.fillStyle = color;
      ctx.font = 'bold 8px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(t.id.replace('TROLLEY-', 'T-'), t.x, t.y - 12);

      // item count badge
      if (t.cartItems.length > 0) {
        ctx.fillStyle = '#1e293b';
        ctx.beginPath();
        ctx.arc(t.x + 8, t.y - 8, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = color;
        ctx.font = 'bold 7px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(String(t.cartItems.length), t.x + 8, t.y - 5);
      }
    });
  }, [trolleys]);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
        <h2 className="font-semibold text-sm text-white">Live Store Map</h2>
        <span className="flex items-center gap-1.5 text-xs text-emerald-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          {trolleys.length} trolleys active
        </span>
      </div>
      <div className="p-4">
        <canvas
          ref={canvasRef}
          width={560}
          height={380}
          className="w-full rounded-xl bg-slate-950/50"
        />
      </div>
    </div>
  );
}
