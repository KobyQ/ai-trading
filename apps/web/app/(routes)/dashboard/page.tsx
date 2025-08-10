'use client';

import { useState } from 'react';
import { supabase } from '@lib/supabase';

export default function Page() {
  const [status, setStatus] = useState<string>('');

  const triggerKillSwitch = async () => {
    setStatus('Executing...');
    try {
      const client = supabase();
      const { data, error } = await client.functions.invoke('kill-switch', {
        method: 'POST',
      });
      if (error) {
        setStatus(`Error: ${error.message}`);
      } else {
        setStatus('Kill switch activated');
      }
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    }
  };

  return (
    <div>
      <h2>Dashboard</h2>
      <button onClick={triggerKillSwitch}>Trigger Kill Switch</button>
      {status && <p>{status}</p>}
    </div>
  );
}
