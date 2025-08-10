'use client';

import { useEffect, useState } from 'react';

type Request = {
  id: string;
  trade_id: string;
  price: number;
  expires_at: string;
};

export default function Page() {
  const [requests, setRequests] = useState<Request[]>([]);

  const load = async () => {
    const res = await fetch('/api/profit-take-requests');
    const json = await res.json();
    setRequests(json.requests ?? []);
  };

  useEffect(() => {
    load();
  }, []);

  const act = async (id: string, action: 'approve' | 'deny') => {
    await fetch(`/api/profit-take-requests/${id}/${action}`, { method: 'POST' });
    await load();
  };

  return (
    <div>
      <h2>Profit-Take Requests</h2>
      {requests.length === 0 && <p>No pending requests.</p>}
      <ul>
        {requests.map((r) => (
          <li key={r.id}>
            Trade {r.trade_id} @ {r.price}
            <button onClick={() => act(r.id, 'approve')}>Approve</button>
            <button onClick={() => act(r.id, 'deny')}>Deny</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
