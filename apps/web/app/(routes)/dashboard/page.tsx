'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@lib/supabase';

type Trade = {
  id: string;
  symbol: string;
  side: string;
  qty: number;
};

export default function Page() {
  const client = supabase();
  const [pnl, setPnl] = useState<number | null>(null);
  const [openTrades, setOpenTrades] = useState<Trade[]>([]);
  const [status, setStatus] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const { data: pnlData } = await client.rpc('portfolio_pnl');
        setPnl(typeof pnlData === 'number' ? pnlData : 0);
      } catch {
        setPnl(0);
      }

      const { data: tradesData } = await client
        .from('trades')
        .select('id, symbol, side, qty')
        .eq('status', 'OPEN')
        .order('opened_at', { ascending: false });

      setOpenTrades(tradesData ?? []);
    };
    load();
  }, [client]);

  const triggerKillSwitch = async () => {
    setStatus('Executing...');
    try {
      // Try Supabase Edge Function first
      const { error } = await client.functions.invoke('kill-switch', { body: {} });
      if (error) {
        // Fallback to API route if the function isn't configured
        const res = await fetch('/api/kill-switch', { method: 'POST' });
        setStatus(res.ok ? 'Kill switch triggered' : 'Failed to trigger kill switch');
      } else {
        setStatus('Kill switch activated');
      }
    } catch (e: any) {
      setStatus(`Error: ${e?.message ?? 'Unknown error'}`);
    }
  };

  return (
    <div>
      <h2>Dashboard</h2>

      <div style={{ marginBottom: 16 }}>
        <strong>PnL:</strong> {pnl ?? '...'}
      </div>

      <div style={{ marginBottom: 16 }}>
        <h3>Open Trades</h3>
        {openTrades.length === 0 && <p>No open trades.</p>}
        <ul>
          {openTrades.map((t) => (
            <li key={t.id}>
              {t.symbol} {t.side} x{t.qty}
            </li>
          ))}
        </ul>
      </div>

      <button onClick={triggerKillSwitch}>Kill Switch</button>
      {status && <p>{status}</p>}
    </div>
  );
}