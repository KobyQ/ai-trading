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
  const client = supabase;
  const [pnl, setPnl] = useState<number | null>(null);
  const [openTrades, setOpenTrades] = useState<Trade[]>([]);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let active = true;

    const load = async () => {
      // Load PnL
      try {
        const { data: pnlData, error: pnlError } = await client.rpc('portfolio_pnl');
        if (pnlError) throw pnlError;
        if (active) {
          setPnl(typeof pnlData === 'number' ? pnlData : 0);
        }
      } catch {
        if (active) setPnl(0);
      }

      // Load open trades
      try {
        const { data: tradesData, error: tradesError } = await client
          .from('trades')
          .select('id, symbol, side, qty')
          .eq('status', 'OPEN')
          .order('opened_at', { ascending: false });

        if (tradesError) throw tradesError;
        if (active) setOpenTrades(tradesData ?? []);
      } catch {
        if (active) setOpenTrades([]);
      }
    };

    load();

    return () => {
      active = false;
    };
  }, [client]);

  const triggerKillSwitch = async () => {
    setStatus('Execu
