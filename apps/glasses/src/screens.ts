// State -> screen text. Pure. Three lines map to three containers:
// big status word (l1), amount/detail (l2), one hint (l3).
// Glyph policy: the design guidelines do not list check, warning, middle dot
// or ellipsis as supported (unsupported chars are silently dropped), so we use
// plain ASCII. Flip these constants only after verifying on hardware.
export const G = { warn: '(!)', sep: '|', ell: '...' } as const

export const MAX_LINE = 64
export const MAX_TOTAL = 450

export type Screen = { l1: string; l2: string; l3: string }

export interface Sale { saleId: string; amount: string; asset: string; receivedTotal?: string; from?: string; ageSec?: number; paidAt?: number; extra?: string; missing?: string }
export interface Status { state: string; sale?: Sale; unmatched?: { amount: string; from: string; paymentId: string } }

export type View =
  | { v: 'pair'; code?: string }
  | { v: 'idle' }
  | { v: 'listening' }
  | { v: 'msg'; text: string; sub?: string; hint?: string }
  | { v: 'offline' }
  | { v: 'receipt' }
  | { v: 'today'; count: number; total: string; asset: string }
  | { v: 'sale'; status: Status }
  | { v: 'preset'; amount: number; asset: string }

export const PRESETS = [5, 10, 12, 20, 50]
export const HINT_IDLE = `tap: speak  ${G.sep}  swipe: presets  ${G.sep}  2x tap: exit`

export function clip(s: string, n = MAX_LINE): string {
  return s.length <= n ? s : s.slice(0, Math.max(0, n - 1)) + '~'
}

export function shortAddr(a?: string): string {
  if (!a) return 'unknown'
  return a.length <= 8 ? a : `${a.slice(0, 2)}${G.ell}${a.slice(-3)}`
}

function money(s?: Sale): string { return s ? `${s.amount} ${s.asset}` : '' }
/** UTC hh:mm of the payment (stable; never counts up from sale creation). */
export function clock(epochSec?: number): string {
  if (epochSec === undefined || !Number.isFinite(epochSec)) return ''
  const d = new Date(epochSec * 1000)
  return ` ${G.sep} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

/** Scroll step: the first swipe from idle enters preset mode at the first preset; later swipes advance. */
export function nextPreset(idx: number, dir: 'up' | 'down'): number {
  const n = PRESETS.length
  if (idx < 0) return 0
  return (idx + (dir === 'up' ? 1 : n - 1)) % n
}

export function renderSale(st: Status): Screen {
  const s = st.sale
  const amt = money(s)
  switch (st.state) {
    case 'WAITING':
      return { l1: `READY  ${amt}`, l2: `waiting for payment${G.ell}`, l3: '2x tap: cancel sale' }
    case 'PAID':
      return { l1: `PAID  ${amt}`, l2: `from ${shortAddr(s?.from)}${clock(s?.paidAt)}`, l3: 'tap: send receipt' }
    case 'EXTRA':
      return { l1: `PAID  ${amt}`, l2: `+${s?.extra ?? '?'} extra ${G.sep} from ${shortAddr(s?.from)}`, l3: 'tap: send receipt' }
    case 'SHORT':
      return { l1: `SHORT  ${s?.receivedTotal ?? '?'} / ${s?.amount ?? '?'}`, l2: `${s?.missing ?? '?'} ${s?.asset ?? ''} missing`, l3: '2x tap: cancel sale' }
    case 'DUPLICATE':
      return { l1: `DUPLICATE  ${amt}`, l2: 'second payment on a paid sale', l3: 'tap: ok' }
    case 'FAKE':
      return { l1: `${G.warn} FAKE TOKEN - NOT PAID`, l2: `${amt} wrong token`, l3: 'tap: ok  ' + G.sep + '  do NOT hand over goods' }
    case 'UNMATCHED': {
      const u = st.unmatched
      return { l1: `UNMATCHED  ${u?.amount ?? ''}`, l2: `from ${shortAddr(u?.from)} ${G.sep} no sale ref`, l3: 'tap: attach to open sale' }
    }
    case 'LATE':
      return { l1: `LATE PAYMENT  ${amt}`, l2: `after sale closed ${G.sep} from ${shortAddr(s?.from)}`, l3: 'tap: ok' }
    default:
      return { l1: 'Say a price', l2: '', l3: HINT_IDLE }
  }
}

export function render(view: View): Screen {
  let sc: Screen
  switch (view.v) {
    case 'pair':
      sc = { l1: 'ShopTill', l2: view.code ? `Pair: send ${view.code} to @ShopTillBot` : `Getting pairing code${G.ell}`, l3: '2x tap: exit' }
      break
    case 'idle': sc = { l1: 'Say a price', l2: '', l3: HINT_IDLE }; break
    case 'listening': sc = { l1: `Listening${G.ell}`, l2: 'say the price, e.g. "twelve"', l3: 'tap: stop' }; break
    case 'preset': sc = { l1: `Preset  ${view.amount.toFixed(2)} ${view.asset}`, l2: 'swipe: change', l3: `tap: start sale ${G.sep} 2x tap: back` }; break
    case 'offline': sc = { l1: `Offline - retrying${G.ell}`, l2: '', l3: '2x tap: cancel' }; break
    case 'receipt': sc = { l1: 'RECEIPT SENT', l2: 'customer has it in Telegram', l3: '' }; break
    case 'today': sc = { l1: `Today: ${view.count} sales ${G.sep} ${view.total}`, l2: view.asset, l3: 'swipe up: back' }; break
    case 'msg': sc = { l1: view.text, l2: view.sub ?? '', l3: view.hint ?? 'tap: ok' }; break
    case 'sale': sc = renderSale(view.status); break
  }
  const out = { l1: clip(sc.l1), l2: clip(sc.l2), l3: clip(sc.l3) }
  const total = out.l1.length + out.l2.length + out.l3.length
  if (total > MAX_TOTAL) out.l3 = clip(out.l3, Math.max(0, MAX_TOTAL - out.l1.length - out.l2.length))
  return out
}
