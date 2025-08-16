import ThemeToggle from './theme-toggle';

export const metadata = { title: 'AI Trading System', description: 'Daily/Hourly AI trading with human approvals' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'ui-sans-serif, system-ui', margin: 0, background: '#121212', color: '#e5e5e5' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: 16 }}>
          <header style={{ display: 'flex', gap: 16, alignItems: 'center', padding: '8px 0', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <h1 style={{ fontSize: 20, margin: 0 }}>AI Trading System</h1>
              <nav style={{ display: 'flex', gap: 12, marginLeft: 16 }}>
                <a style={{ color: 'inherit' }} href="/dashboard">Dashboard</a>
                <a style={{ color: 'inherit' }} href="/opportunities">Opportunities</a>
                <a style={{ color: 'inherit' }} href="/trades">Trades</a>
                <a style={{ color: 'inherit' }} href="/approval">Approval</a>
                <a style={{ color: 'inherit' }} href="/audit-log">Audit Log</a>
                <a style={{ color: 'inherit' }} href="/settings">Settings</a>
              </nav>
            </div>
            <ThemeToggle />
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
