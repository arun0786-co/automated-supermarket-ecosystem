import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ASE-PRIME Dashboard',
  description: 'Automated Supermarket Ecosystem - Fleet Command',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-slate-950 text-slate-50 antialiased selection:bg-cyan-500/30">
        <div className="fixed inset-0 z-[-1] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950"></div>
        {children}
      </body>
    </html>
  );
}
