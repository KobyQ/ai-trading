import { NextRequest, NextResponse } from 'next/server';
export async function POST(_req: NextRequest, { params }: { params: { id: string }}) {
  // TODO: validate idempotency, risk limits, create orders, call broker (paper), persist trade
  return NextResponse.json({ ok: true, tradeId: `T-${params.id}` });
}
