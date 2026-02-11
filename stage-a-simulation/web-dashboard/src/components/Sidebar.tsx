'use client';

import { ShoppingCart, Zap, BarChart2, Wallet, Box, Settings } from 'lucide-react';
import Link from 'next/link';

const navItems = [
  { icon: BarChart2, label: 'Dashboard', href: '/', active: true },
  { icon: ShoppingCart, label: 'Trolleys', href: '#' },
  { icon: Box, label: 'Inventory', href: '#' },
  { icon: Wallet, label: 'Wallets', href: '#' },
  { icon: Zap, label: 'Analytics', href: '#' },
  { icon: Settings, label: 'Settings', href: '#' },
];

export default function Sidebar() {
  return (
    <aside className="hidden md:flex flex-col w-16 lg:w-56 min-h-screen bg-slate-900/80 border-r border-slate-800 py-6 shrink-0">
      {/* logo */}
      <div className="px-3 lg:px-5 mb-8">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shrink-0">
            <ShoppingCart size={16} className="text-white" />
          </div>
          <span className="hidden lg:block font-bold text-sm text-white tracking-tight leading-tight">
            ASE-PRIME<br />
            <span className="text-slate-400 font-normal">Command Center</span>
          </span>
        </div>
      </div>

      {/* nav */}
      <nav className="flex-1 px-2 space-y-1">
        {navItems.map(({ icon: Icon, label, href, active }) => (
          <Link
            key={label}
            href={href}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all group
              ${active
                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'}`}
          >
            <Icon size={18} className="shrink-0" />
            <span className="hidden lg:block">{label}</span>
          </Link>
        ))}
      </nav>

      {/* stage badge */}
      <div className="px-3 mt-4">
        <div className="hidden lg:flex flex-col gap-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3">
          <span className="text-[10px] text-emerald-400 font-semibold uppercase tracking-widest">Stage A</span>
          <span className="text-xs text-slate-400">Simulation active</span>
        </div>
      </div>
    </aside>
  );
}
