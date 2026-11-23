import { describe, expect, it } from 'vitest'
import { makeDebouncer, normalizeEvent } from './events'
import { encodeWav } from './wav'
import { MAX_LINE, MAX_TOTAL, nextPreset, render, renderSale, type View } from './screens'

describe('normalizeEvent', () => {
  it('sysEvent without eventType is a tap', () => expect(normalizeEvent({ sysEvent: {} }).kind).toBe('tap'))
  it('null eventType is a tap', () => expect(normalizeEvent({ textEvent: { eventType: null } }).kind).toBe('tap'))
  it('simulator listEvent', () => expect(normalizeEvent({ listEvent: { eventType: 3 } }).kind).toBe('double'))
  it('scroll', () => {
    expect(normalizeEvent({ sysEvent: { eventType: 1 } }).kind).toBe('up')
    expect(normalizeEvent({ textEvent: { eventType: 2 } }).kind).toBe('down')
  })
  it('exit', () => expect(normalizeEvent({ sysEvent: { eventType: 7 } }).kind).toBe('exit'))
  it('audio frame is not a tap', () => {
    const r = normalizeEvent({ audioEvent: { audioPcm: [1, 2, 3, 4] } })
    expect(r.kind).toBe('pcm')
  })
  it('empty envelope is none', () => expect(normalizeEvent({}).kind).toBe('none'))
})

describe('debouncer', () => {
  it('passes one of a burst', () => {
    let t = 0
    const ok = makeDebouncer(300, () => t)
    const hits = [0, 20, 40, 100, 250, 400].map((x) => { t = x; return ok() })
    expect(hits).toEqual([true, false, false, false, false, true])
  })
})

describe('presets', () => {
  it('first swipe from idle lands on 5.00 and later swipes advance', () => {
    expect(nextPreset(-1, 'up')).toBe(0)
    expect(nextPreset(0, 'up')).toBe(1)
    expect(nextPreset(1, 'up')).toBe(2)
    expect(nextPreset(0, 'down')).toBe(4)
  })
  it('receipt message shows both lines', () => {
    const s = render({ v: 'msg', text: 'RECEIPT SENT', sub: 'customer has it in Telegram', hint: '' })
    expect(s.l2).toBe('customer has it in Telegram')
  })
})

describe('encodeWav', () => {
  it('writes a valid 16k mono header', () => {
    const w = encodeWav([new Uint8Array(10), new Uint8Array(6)])
    const v = new DataView(w.buffer)
    expect(String.fromCharCode(...w.slice(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...w.slice(8, 12))).toBe('WAVE')
    expect(v.getUint32(4, true)).toBe(36 + 16)
    expect(v.getUint16(22, true)).toBe(1)
    expect(v.getUint32(24, true)).toBe(16000)
    expect(v.getUint32(28, true)).toBe(32000)
    expect(v.getUint16(34, true)).toBe(16)
    expect(v.getUint32(40, true)).toBe(16)
    expect(w.length).toBe(60)
  })
})

describe('screens', () => {
  const sale = { saleId: 's', amount: '12.00', asset: 'USDT', from: 'EQabcdefghijklx4f', ageSec: 4, paidAt: 1763924940, receivedTotal: '9.00', missing: '3.00', extra: '2.00' }
  it('ready', () => expect(renderSale({ state: 'WAITING', sale }).l1).toBe('READY  12.00 USDT'))
  it('paid', () => {
    const s = renderSale({ state: 'PAID', sale })
    expect(s.l1).toBe('PAID  12.00 USDT')
    expect(s.l2).toBe('from EQ...x4f | 19:09')
    expect(s.l2).not.toContain('ago')
    expect(s.l3).toBe('tap: send receipt')
  })
  it('fake is loud', () => expect(renderSale({ state: 'FAKE', sale }).l1).toContain('FAKE TOKEN - NOT PAID'))
  it('short shows missing', () => expect(renderSale({ state: 'SHORT', sale }).l2).toContain('3.00'))
  it('unmatched', () => expect(renderSale({ state: 'UNMATCHED', unmatched: { amount: '12.00', from: 'EQabcdefx4f', paymentId: 'p' } }).l1).toBe('UNMATCHED  12.00'))
  it('every screen is ascii, <=64/line, <=450 total, with absurd input', () => {
    const long = 'x'.repeat(300)
    const bad = { saleId: 's', amount: long, asset: long, from: long, missing: long, receivedTotal: long, extra: long }
    const views: View[] = [
      { v: 'pair', code: 'TILL-4821' }, { v: 'pair', code: long }, { v: 'idle' }, { v: 'listening' }, { v: 'offline' }, { v: 'receipt' },
      { v: 'preset', amount: 12, asset: 'USDT' }, { v: 'today', count: 14, total: long, asset: 'USDT' },
      { v: 'msg', text: long, hint: long },
      ...['WAITING', 'PAID', 'EXTRA', 'SHORT', 'DUPLICATE', 'FAKE', 'UNMATCHED', 'LATE', 'IDLE'].flatMap((state): View[] => [
        { v: 'sale', status: { state, sale, unmatched: { amount: '12.00', from: 'EQx', paymentId: 'p' } } },
        { v: 'sale', status: { state, sale: bad, unmatched: { amount: long, from: long, paymentId: 'p' } } },
      ]),
    ]
    for (const v of views) {
      const s = render(v)
      for (const line of [s.l1, s.l2, s.l3]) {
        expect(line.length).toBeLessThanOrEqual(MAX_LINE)
        expect(/^[\x20-\x7e]*$/.test(line)).toBe(true)
      }
      expect(s.l1.length + s.l2.length + s.l3.length).toBeLessThanOrEqual(MAX_TOTAL)
    }
  })
  it('idle hint matches design', () => expect(render({ v: 'idle' }).l1).toBe('Say a price'))
  it('pair shows code', () => expect(render({ v: 'pair', code: 'TILL-4821' }).l2).toBe('Pair: send TILL-4821 to @ShopTillBot'))
})

describe('voice confirm screen', () => {
  it('shows the heard price and transcript before any sale starts', () => {
    const sc = render({ v: 'confirm', amount: '12.50', asset: 'USDT', heard: 'twelve fifty' })
    expect(sc.l1).toBe('Heard  12.50 USDT')
    expect(sc.l2).toBe('you said: "twelve fifty"')
    expect(sc.l3).toMatch(/tap: start sale/)
    expect(sc.l3).toMatch(/2x tap: say again/)
  })
})
