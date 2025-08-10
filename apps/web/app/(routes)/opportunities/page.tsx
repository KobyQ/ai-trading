'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@lib/supabase';

type Opportunity = {
  id: string;
  symbol: string;
  side: string;
  ai_summary: string | null;
};

export default function Page() {
  const client = supabase();
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const { data } = await client
        .from('trade_opportunities')
        .select('id, symbol, side, ai_summary')
        .eq('status', 'PENDING_APPROVAL')
        .order('created_at', { ascending: false });
      setOpps(data ?? []);
      setLoading(false);
    };
    load();
  }, [client]);

  const approve = async (id: string) => {
    await fetch(`/api/opportunities/${id}/approve`, { method: 'POST' });
    setOpps((prev) => prev.filter((o) => o.id !== id));
  };

  const reject = async (id: string) => {
    await client
      .from('trade_opportunities')
      .update({ status: 'REJECTED' })
      .eq('id', id);
    setOpps((prev) => prev.filter((o) => o.id !== id));
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      <h2>Opportunities</h2>
      {opps.length === 0 && <p>No pending opportunities.</p>}
      <ul>
        {opps.map((o) => (
          <li key={o.id} style={{ marginBottom: 16 }}>
            <div>
              <strong>{o.symbol}</strong> {o.side}
            </div>
            {o.ai_summary && <p>{o.ai_summary}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => approve(o.id)}>Approve</button>
              <button onClick={() => reject(o.id)}>Reject</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

