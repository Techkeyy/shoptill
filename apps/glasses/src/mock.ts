// DEV ONLY. Active when VITE_MOCK=1. Fakes the server in-browser so the app
// can be demoed in the simulator. A sale arms, then walks WAITING -> SHORT ->
// PAID over ~10 s. Never ship a build with VITE_MOCK=1.
type MockSale = { saleId: string; amount: string; asset: string }
let sale: MockSale | null = null
let sales = 14
let total = 186
let polls = 0

export function stt() { return { text: 'twelve', amount: '12.00' } }

export function handle(path: string, body: any): unknown {
  const p = path.split('?')[0]
  if (p === '/api/device/pair') return { paired: true, shopName: 'Demo Cafe', deviceSecret: 'mock-secret' }
  if (p === '/api/till/arm') { sale = { saleId: 's' + Date.now(), amount: body.amount, asset: body.asset }; polls = 0; return { saleId: sale.saleId } }
  if (p === '/api/till/void') { sale = null; return {} }
  if (p === '/api/till/receipt') { sales++; total += Number(sale?.amount ?? 0); sale = null; return {} }
  if (p === '/api/till/attach') return {}
  if (p === '/api/today') return { count: sales, total: total.toFixed(2), asset: 'USDT' }
  if (p === '/api/till/status') {
    if (!sale) return { state: 'IDLE' }
    polls++
    const s = { saleId: sale.saleId, amount: sale.amount, asset: sale.asset }
    if (polls < 3) return { state: 'WAITING', sale: s }
    if (polls < 5) return { state: 'SHORT', sale: { ...s, receivedTotal: '9.00', missing: '3.00' } }
    return { state: 'PAID', sale: { ...s, from: 'EQ12345x4f', ageSec: (polls - 5) * 2, paidAt: Math.floor(Date.now() / 1000) } }
  }
  throw new Error('mock: unknown ' + path)
}
