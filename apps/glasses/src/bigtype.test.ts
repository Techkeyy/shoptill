import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  GEOM, IMG_H, IMG_W, SCREEN_H, SCREEN_W, amountKey, bigLayout, drawAmountImage, drawGlyph, drawWordImage,
  encodePng4, fitFont, renderAmountPng, renderWordPng, rgbaToGray4, wordKey, type Ctx2D, type Glyph,
} from './bigtype'
import { MAX_LINE, ageText, amountDiffers, render, type Status } from './screens'

// --- a recording fake canvas context ----------------------------------------
function fakeCtx(): Ctx2D & { ops: string[] } {
  const ops: string[] = []
  let font = '10px x'
  return {
    ops,
    fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', textBaseline: 'alphabetic',
    get font() { return font }, set font(v: string) { font = v },
    fillRect: () => ops.push('fillRect'),
    fillText: (t) => ops.push(`text:${t}`),
    measureText: (t) => ({ width: t.length * parseInt(/(\d+)px/.exec(font)![1]!, 10) * 0.62 }),
    beginPath: () => ops.push('begin'), moveTo: () => ops.push('move'), lineTo: () => ops.push('line'),
    closePath: () => ops.push('close'), arc: () => ops.push('arc'), stroke: () => ops.push('stroke'), fill: () => ops.push('fill'),
  }
}

// --- PNG reader (only what the test needs) ------------------------------------
function readPng(png: Uint8Array) {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength)
  expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  const chunks: Record<string, Uint8Array> = {}
  let p = 8
  while (p < png.length) {
    const len = dv.getUint32(p)
    const type = String.fromCharCode(...png.slice(p + 4, p + 8))
    const data = png.slice(p + 8, p + 8 + len)
    // CRC32 of type+data
    let c = 0xffffffff
    for (const b of png.slice(p + 4, p + 8 + len)) {
      c ^= b
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    expect((c ^ 0xffffffff) >>> 0).toBe(dv.getUint32(p + 8 + len))
    chunks[type] = data
    p += 12 + len
  }
  const ih = new DataView(chunks.IHDR!.buffer, chunks.IHDR!.byteOffset)
  return { w: ih.getUint32(0), h: ih.getUint32(4), depth: chunks.IHDR![8]!, colour: chunks.IHDR![9]!, plte: chunks.PLTE!, idat: chunks.IDAT!, hasEnd: 'IEND' in chunks }
}
function decode(png: Uint8Array) {
  const r = readPng(png)
  const raw = new Uint8Array(inflateSync(r.idat))
  const rowBytes = Math.ceil(r.w / 2)
  const px = new Uint8Array(r.w * r.h)
  for (let y = 0; y < r.h; y++) {
    expect(raw[y * (rowBytes + 1)]).toBe(0) // filter none
    for (let x = 0; x < r.w; x++) {
      const b = raw[y * (rowBytes + 1) + 1 + (x >> 1)]!
      px[y * r.w + x] = x & 1 ? b & 15 : b >> 4
    }
  }
  return { ...r, px }
}

describe('rgbaToGray4', () => {
  it('maps black, white and mid grey to 0, 15 and ~8', () => {
    const rgba = Uint8Array.of(0, 0, 0, 255, 255, 255, 255, 255, 128, 128, 128, 255)
    expect(Array.from(rgbaToGray4(rgba, 3, 1))).toEqual([0, 15, 8])
  })
  it('composites alpha over black and clamps to 0..15', () => {
    const rgba = [255, 255, 255, 0, 255, 255, 255, 128, 300, 300, 300, 255]
    const g = rgbaToGray4(rgba, 3, 1)
    expect(g[0]).toBe(0)
    expect(g[1]).toBe(8)
    expect(g[2]).toBe(15)
  })
  it('refuses a short buffer', () => {
    expect(() => rgbaToGray4(new Uint8Array(3), 1, 1)).toThrow()
  })
})

describe('encodePng4 (16-level greyscale indexed PNG)', () => {
  it('is a valid 4-bit indexed PNG with a 16-step grey palette that round-trips pixels', () => {
    const w = 7, h = 3 // odd width exercises the half-byte row tail
    const px = Uint8Array.from({ length: w * h }, (_, i) => i % 16)
    const d = decode(encodePng4(px, w, h))
    expect([d.w, d.h, d.depth, d.colour, d.hasEnd]).toEqual([7, 3, 4, 3, true])
    expect(d.plte.length).toBe(48)
    expect(Array.from(d.plte.slice(0, 3))).toEqual([0, 0, 0])
    expect(Array.from(d.plte.slice(45, 48))).toEqual([255, 255, 255])
    expect(Array.from(d.px)).toEqual(Array.from(px))
  })
  it('handles a full-size image and stays small (stored deflate, 4 bits per pixel)', () => {
    const px = new Uint8Array(IMG_W * IMG_H).map((_, i) => (i * 7) % 16)
    const png = encodePng4(px, IMG_W, IMG_H)
    expect(png.length).toBeLessThan(11_000)
    expect(Array.from(decode(png).px)).toEqual(Array.from(px))
  })
  it('rejects mismatched dimensions', () => {
    expect(() => encodePng4(new Uint8Array(5), 2, 3)).toThrow()
  })
})

describe('page geometry', () => {
  const boxes = [GEOM.word, GEOM.amount, GEOM.detail, GEOM.hint]
  it('images respect the hardware-safe limit (<=288x96) and the page limits', () => {
    for (const g of [GEOM.word, GEOM.amount]) {
      expect(g.w).toBeLessThanOrEqual(288)
      expect(g.h).toBeLessThanOrEqual(96)
      expect(g.w).toBeGreaterThanOrEqual(20)
    }
    expect(2).toBeLessThanOrEqual(4) // image containers
    expect(boxes.length).toBeLessThanOrEqual(12) // <=4 image + <=8 text
  })
  it('everything is inside the 576x288 canvas and nothing overlaps', () => {
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.y).toBeGreaterThanOrEqual(0)
      expect(b.x + b.w).toBeLessThanOrEqual(SCREEN_W)
      expect(b.y + b.h).toBeLessThanOrEqual(SCREEN_H)
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!, b = boxes[j]!
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
      expect(overlap).toBe(false)
    }
  })
  it('container ids are unique', () => {
    expect(new Set(boxes.map((b) => b.id)).size).toBe(boxes.length)
  })
})

const sale = { saleId: 's1', amount: '12.00', asset: 'USDT' }
const view = (status: Status, confirmAttach = false) => ({ v: 'sale' as const, status, confirmAttach })

describe('bigLayout', () => {
  it('is null for non-sale views and IDLE', () => {
    expect(bigLayout({ v: 'idle' })).toBeNull()
    expect(bigLayout({ v: 'listening' })).toBeNull()
    expect(bigLayout({ v: 'pair', code: 'TILL-123456' })).toBeNull()
    expect(bigLayout(view({ state: 'IDLE' }))).toBeNull()
  })
  it('READY: word, amount, asset', () => {
    const b = bigLayout(view({ state: 'WAITING', sale }))!
    expect([b.word, b.glyph, b.amount, b.sub]).toEqual(['READY', 'wait', '12.00', 'USDT'])
  })
  it('PAID: big check, amount, detail with sender and UTC clock, receipt hint', () => {
    const b = bigLayout(view({ state: 'PAID', sale: { ...sale, from: '0QA4…sO5', paidAt: Date.UTC(2026, 10, 23, 19, 9) / 1000 } }))!
    expect([b.word, b.glyph, b.amount]).toEqual(['PAID', 'check', '12.00'])
    expect(b.detail).toBe('from 0QA4…sO5 | 19:09')
    expect(b.hint).toBe('tap: send receipt')
  })
  it('EXTRA shows PAID with the extra in the sub line', () => {
    const b = bigLayout(view({ state: 'EXTRA', sale: { ...sale, extra: '1.00' } }))!
    expect([b.word, b.glyph, b.sub]).toEqual(['PAID', 'check', '+1.00 extra'])
  })
  it('SHORT shows received/expected and the missing amount', () => {
    const b = bigLayout(view({ state: 'SHORT', sale: { ...sale, receivedTotal: '9.00', missing: '3.00' } }))!
    expect([b.word, b.glyph, b.amount, b.sub]).toEqual(['SHORT', 'warn', '9.00/12.00', '3.00 missing'])
  })
  it('FAKE is a warning that says NOT PAID', () => {
    const b = bigLayout(view({ state: 'FAKE', sale }))!
    expect([b.word, b.glyph, b.sub]).toEqual(['FAKE', 'warn', 'NOT PAID'])
    expect(b.detail).toContain('do NOT hand over')
  })
  it('CONFIRMING is never shown as PAID', () => {
    const b = bigLayout(view({ state: 'CONFIRMING', sale }))!
    expect(b.word).not.toBe('PAID')
    expect(b.glyph).toBe('wait')
    expect(b.detail).toContain('confirming')
    expect(b.hint).toContain('NOT PAID')
  })
  it('UNMATCHED shows amount, sender and age; a differing amount needs a second tap', () => {
    const st: Status = { state: 'UNMATCHED', sale, unmatched: { amount: '9.00', from: '0QA4…sO5', paymentId: 'tx', asset: 'USDT', ageSec: 125 } }
    const b = bigLayout(view(st))!
    expect([b.glyph, b.amount, b.sub]).toEqual(['question', '9.00', 'USDT'])
    expect(b.detail).toBe('from 0QA4…sO5 | 2 min ago')
    expect(b.hint).toContain('amount differs')
    expect(b.hint).toContain('twice')
    expect(bigLayout(view(st, true))!.hint).toContain('AMOUNT DIFFERS')
    const same: Status = { ...st, unmatched: { ...st.unmatched!, amount: '12.00' } }
    expect(bigLayout(view(same))!.hint).toBe('tap: attach to open sale')
  })
  it('image cache keys change only when the picture changes', () => {
    const a = bigLayout(view({ state: 'WAITING', sale }))!
    const b = bigLayout(view({ state: 'WAITING', sale: { ...sale } }))!
    const c = bigLayout(view({ state: 'PAID', sale }))!
    expect(wordKey(a)).toBe(wordKey(b))
    expect(amountKey(a)).toBe(amountKey(c)) // same amount: the amount image is not re-sent PAID after READY
    expect(wordKey(a)).not.toBe(wordKey(c))
  })
})

describe('UNMATCHED helpers and text fallback', () => {
  it('amountDiffers compares numerically', () => {
    expect(amountDiffers({ state: 'UNMATCHED', sale, unmatched: { amount: '12', from: 'x', paymentId: 'p' } })).toBe(false)
    expect(amountDiffers({ state: 'UNMATCHED', sale, unmatched: { amount: '12.50', from: 'x', paymentId: 'p' } })).toBe(true)
    expect(amountDiffers({ state: 'UNMATCHED', unmatched: { amount: '12.00', from: 'x', paymentId: 'p' } })).toBe(true)
  })
  it('ageText', () => {
    expect([ageText(5), ageText(59), ageText(60), ageText(3599), ageText(7300), ageText(undefined), ageText(-1)])
      .toEqual(['5s ago', '59s ago', '1 min ago', '59 min ago', '2h ago', '', ''])
  })
  it('text fallback for UNMATCHED has amount, sender, age and the attach rule', () => {
    const s = render(view({ state: 'UNMATCHED', sale, unmatched: { amount: '9.00', from: '0QA4…sO5', paymentId: 'tx', asset: 'USDT', ageSec: 7 } }))
    expect(s.l1).toBe('UNMATCHED  9.00 USDT')
    expect(s.l2).toBe('from 0QA4…sO5 | 7s ago')
    expect(s.l3).toContain('amount differs')
    expect(s.l3.length).toBeLessThanOrEqual(MAX_LINE)
  })
  it('text fallback for CONFIRMING', () => {
    const s = render(view({ state: 'CONFIRMING', sale }))
    expect(s.l1).toBe('PAYMENT SEEN  12.00 USDT')
    expect(s.l2).toContain('not paid yet')
  })
})

describe('drawing', () => {
  it('fitFont shrinks long text to the width and respects the floor', () => {
    const c = fakeCtx()
    expect(fitFont(c, 'PAID', 48, 18, 400)).toBe(48)
    const px = fitFont(c, 'UNMATCHED', 48, 18, 120)
    expect(px).toBeLessThan(48)
    c.font = `bold ${px}px x`
    expect(c.measureText("UNMATCHED").width).toBeLessThanOrEqual(120)
    expect(fitFont(c, 'X'.repeat(80), 48, 18, 10)).toBe(18)
  })
  it('every glyph draws something (check mark is a path, not a font character)', () => {
    for (const g of ['check', 'warn', 'wait', 'question'] as Glyph[]) {
      const c = fakeCtx()
      drawGlyph(c, g, 0, 0, 64)
      expect(c.ops.length).toBeGreaterThan(0)
    }
    const c = fakeCtx()
    drawGlyph(c, 'check', 0, 0, 64)
    expect(c.ops.filter((o) => o === 'line')).toHaveLength(2)
    expect(c.ops.some((o) => o.startsWith('text:'))).toBe(false)
  })
  it('word and amount images draw their text', () => {
    const b = bigLayout(view({ state: 'PAID', sale }))!
    const w = fakeCtx(); drawWordImage(w, b)
    expect(w.ops).toContain('text:PAID')
    const a = fakeCtx(); drawAmountImage(a, b)
    expect(a.ops).toContain('text:12.00')
    expect(a.ops).toContain('text:USDT')
  })
  it('renderWordPng / renderAmountPng produce 200x96 4-bit PNGs from a canvas factory', () => {
    const b = bigLayout(view({ state: 'PAID', sale }))!
    const make = () => {
      const rgba = new Uint8Array(IMG_W * IMG_H * 4)
      for (let i = 0; i < IMG_W * IMG_H; i++) { const v = i % 2 ? 255 : 0; rgba.set([v, v, v, 255], i * 4) }
      return { ctx: fakeCtx(), read: () => rgba }
    }
    for (const png of [renderWordPng(b, make), renderAmountPng(b, make)]) {
      const d = decode(png)
      expect([d.w, d.h, d.depth, d.colour]).toEqual([200, 96, 4, 3])
      expect(new Set(d.px)).toEqual(new Set([0, 15]))
    }
  })
  it('without a canvas the renderer throws (so the app falls back to text)', () => {
    const b = bigLayout(view({ state: 'PAID', sale }))!
    expect(() => renderWordPng(b)).toThrow()
  })
})
