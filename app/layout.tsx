import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'SPIDER BETS | The Game. The Odds. Your Strategy.', description: 'Football betting simulation. Virtual money only.', icons: { icon: '/spider.svg' } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en" className="h-full"><head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/></head><body className="min-h-full">{children}</body></html>; }
