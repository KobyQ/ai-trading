export function makeClientOrderId(tradeId: string, n=1){ return `${tradeId}-${n}`; }
export interface OrderRequest {
  symbol: string; side: 'buy'|'sell'; qty: number;
  type: 'market'|'limit'|'stop'|'stop_limit';
  limitPrice?: number; stopPrice?: number; tif?: 'day'|'ioc'|'fok';
}
export async function placePaperOrder(order: OrderRequest){
  // stub: replace with broker integration
  return { id: 'ORD-'+Math.random().toString(36).slice(2), status: 'accepted' };
}
