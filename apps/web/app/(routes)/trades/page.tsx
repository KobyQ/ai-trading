'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@lib/supabase';

type Trade = {
  id: string;
  symbol: string;
  side: string;
  qty: number;
  status: string;
};

export default function Page() {
  const client = supabase;
  const [trades, setTrades] = useState<Trade[]>([]);

  const load = async () => {
    const { data } = await client
      .from('trades')
      .select('id, symbol, side, qty, status')
      .order('opened_at', { ascending: false });
    setTrades(data ?? []);
  };

  useEffect(() => {
    load();
    const channel = client
      .channel('trades-history')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trades' },
        () => {
          load();
        }
      )
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [client]);

  return (
    <div>
      <h2>Trades</h2>
      <ul>
        {trades.map((t) => (
          <li key={t.id}>
            {t.symbol} {t.side} x{t.qty} - {t.status}
          </li>
        ))}
      </ul>
    </div>
  );
}

