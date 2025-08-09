export const metadata = { title: 'AI Trading System', description: 'Daily/Hourly AI trading with human approvals' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'ui-sans-serif, system-ui', margin: 0 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: 16 }}>
          <header style={{ display: 'flex', gap: 16, alignItems: 'center', padding: '8px 0' }}>
            <h1 style={{ fontSize: 20, margin: 0 }}>AI Trading System</h1>
            <nav style={{ display: 'flex', gap: 12, marginLeft: 16 }}>
              <a href="/dashboard">Dashboard</a>
              <a href="/opportunities">Opportunities</a>
              <a href="/trades">Trades</a>
              <a href="/approval">Approval</a>
              <a href="/audit-log">Audit Log</a>
              <a href="/settings">Settings</a>
            </nav>
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
