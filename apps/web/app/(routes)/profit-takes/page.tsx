'use client';

import { useEffect, useState } from 'react';

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

type Request = {
  id: string;
  trade_id: string;
  price: number;
  expires_at: string;
};

export default function Page() {
  const [requests, setRequests] = useState<Request[]>([]);
  const [approving, setApproving] = useState<string | null>(null);

  const load = async () => {
    const res = await fetch('/api/profit-take-requests');
    const json = await res.json();
    setRequests(json.requests ?? []);
  };

  useEffect(() => {
    load();
  }, []);

  const act = async (id: string, action: 'approve' | 'deny') => {
    if (action === 'approve') {
      setApproving(id);
    }
    try {
      await fetch(`/api/profit-take-requests/${id}/${action}`, { method: 'POST' });
      await load();
    } finally {
      if (action === 'approve') {
        setApproving(null);
      }
    }
  };

  return (
    <div>
      <h2>Profit-Take Requests</h2>
      {requests.length === 0 && <p>No pending requests.</p>}
      <ul>
        {requests.map((r) => (
          <li key={r.id}>
            Trade {r.trade_id} @ {r.price}
            <button
              onClick={() => act(r.id, 'approve')}
              disabled={approving === r.id}
              style={{ width: 80, display: 'inline-flex', justifyContent: 'center' }}
            >
              {approving === r.id ? <Spinner /> : 'Approve'}
            </button>
            <button onClick={() => act(r.id, 'deny')} disabled={approving === r.id}>
              Deny
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
