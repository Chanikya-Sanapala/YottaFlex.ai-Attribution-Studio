import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'YottaFlex.ai | Attribution Studio — Enterprise Marketing Attribution & ROI Analytics',
  description:
    'Production-grade multi-touch attribution studio with currency-safe spend reconciliation, deterministic causality rules, and continuous data quality auditing.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>{children}</body>
    </html>
  );
}
