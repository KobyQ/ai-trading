'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@lib/supabase';

function Spinner() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      style={{ display: 'block' }}
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
        fill="none"
        strokeDasharray="31.4 31.4"
        strokeLinecap="round"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          values="0 12 12;360 12 12"
          dur="1s"
          repeatCount="indefinite"
        />
      </circle>
    </svg>
  );
}

type Opportunity = {
  id: string;
  symbol: string;
  side: string;
  ai_summary: string | null;
};

export default function Page() {
  const client = supabase;
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState<string | null>(null);

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
    setApproving(id);
    try {
      await fetch(`/api/opportunities/${id}/approve`, { method: 'POST' });
      setOpps((prev) => prev.filter((o) => o.id !== id));
    } finally {
      setApproving(null);
    }
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
              <button
                onClick={() => approve(o.id)}
                disabled={approving === o.id}
                style={{ width: 80, display: 'flex', justifyContent: 'center' }}
              >
                {approving === o.id ? <Spinner /> : 'Approve'}
              </button>
              <button onClick={() => reject(o.id)} disabled={approving === o.id}>
                Reject
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

