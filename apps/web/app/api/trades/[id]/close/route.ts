import { NextRequest, NextResponse } from 'next/server';
export async function POST(_req: NextRequest, { params }: { params: { id: string }}) {
  // TODO: close trade with reason, cancel remainders, update audit
  return NextResponse.json({ ok: true, closedTradeId: params.id });
}
