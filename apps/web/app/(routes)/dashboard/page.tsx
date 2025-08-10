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
  const [killMsg, setKillMsg] = useState('');

  useEffect(() => {
    const load = async () => {
      const { data: pnlData } = await client.rpc('portfolio_pnl').catch(() => ({ data: 0 }));
      setPnl(typeof pnlData === 'number' ? pnlData : 0);

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
    setKillMsg('Sending...');
    try {
      const res = await fetch('/api/kill-switch', { method: 'POST' });
      setKillMsg(res.ok ? 'Kill switch triggered' : 'Failed to send');
    } catch {
      setKillMsg('Failed to send');
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
      {killMsg && <p>{killMsg}</p>}
    </div>
  );
}

