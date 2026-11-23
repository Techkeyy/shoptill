// Big-type status screens. Pure layout + pixel conversion + PNG encoding live here
// (unit-tested); the canvas drawing helpers take a minimal 2D context so a fake works in tests.
//
// Display facts (Even Hub docs / community devguide): canvas 576x288, 4-bit greyscale green,
// <=4 image containers per page, image container <=288x144 per docs but wide images are flaky on
// hardware, so every image here is 200x96. Images must be 16-level greyscale indexed PNG; an
// RGBA PNG is silently rejected, so we encode our own 4-bit indexed PNG (no dependencies).
import { ageText, attachHint, clock, shortAddr, G, type Sale, type View } from './screens'

export const IMG_W = 200
export const IMG_H = 96
export const SCREEN_W = 576
export const SCREEN_H = 288

/** Page geometry for big mode. Two 200x96 images centred side by side, detail + hint text below. */
export const GEOM = {
  word: { id: 4, name: 'img1', x: 88, y: 0, w: IMG_W, h: IMG_H },
  amount: { id: 5, name: 'img2', x: 288, y: 0, w: IMG_W, h: IMG_H },
  detail: { id: 1, name: 'l1', x: 0, y: 100, w: SCREEN_W, h: 90 }, // the single event-capture container
  hint: { id: 2, name: 'l2', x: 0, y: 200, w: SCREEN_W, h: 88 },
} as const

export type Glyph = 'check' | 'warn' | 'wait' | 'question'

export interface BigLayout {
  glyph: Glyph
  /** status word drawn big (<= ~9 chars) */
  word: string
  /** amount line drawn big */
  amount: string
  /** small line under the amount (asset, "3.00 missing", "NOT PAID") */
  sub: string
  /** text container 1 */
  detail: string
  /** text container 2 */
  hint: string
}

const money = (s?: Sale) => (s ? s.amount : '')
const asset = (s?: Sale) => s?.asset ?? ''

/** Big layout for a sale view, or null when the state stays plain text (IDLE, pairing, listening...). */
export function bigLayout(view: View): BigLayout | null {
  if (view.v !== 'sale') return null
  const st = view.status
  const s = st.sale
  switch (st.state) {
    case 'WAITING':
      return { glyph: 'wait', word: 'READY', amount: money(s), sub: asset(s), detail: `waiting for payment${G.ell}`, hint: '2x tap: cancel sale' }
    case 'CONFIRMING':
      return { glyph: 'wait', word: 'SEEN', amount: money(s), sub: asset(s), detail: `payment seen ${G.sep} confirming${G.ell}`, hint: 'NOT PAID YET - wait' }
    case 'PAID':
      return { glyph: 'check', word: 'PAID', amount: money(s), sub: asset(s), detail: `from ${shortAddr(s?.from)}${clock(s?.paidAt)}`, hint: 'tap: send receipt' }
    case 'EXTRA':
      return { glyph: 'check', word: 'PAID', amount: money(s), sub: `+${s?.extra ?? '?'} extra`, detail: `from ${shortAddr(s?.from)}${clock(s?.paidAt)}`, hint: 'tap: send receipt' }
    case 'SHORT':
      return { glyph: 'warn', word: 'SHORT', amount: `${s?.receivedTotal ?? '?'}/${s?.amount ?? '?'}`, sub: `${s?.missing ?? '?'} missing`, detail: `waiting for the rest${G.ell}`, hint: '2x tap: cancel sale' }
    case 'DUPLICATE':
      return { glyph: 'warn', word: 'DOUBLE', amount: money(s), sub: asset(s), detail: 'second payment on a paid sale', hint: 'tap: ok' }
    case 'FAKE':
      return { glyph: 'warn', word: 'FAKE', amount: money(s), sub: 'NOT PAID', detail: 'wrong token - do NOT hand over goods', hint: 'tap: ok' }
    case 'UNMATCHED': {
      const u = st.unmatched
      const age = ageText(u?.ageSec)
      return {
        glyph: 'question', word: 'NO REF', amount: u?.amount ?? '', sub: u?.asset ?? '',
        detail: `from ${shortAddr(u?.from)}${age ? ` ${G.sep} ${age}` : ''}`, hint: attachHint(st, !!view.confirmAttach),
      }
    }
    case 'LATE':
      return { glyph: 'warn', word: 'LATE', amount: money(s), sub: asset(s), detail: `after sale closed ${G.sep} from ${shortAddr(s?.from)}`, hint: 'tap: ok' }
    default:
      return null
  }
}

/** Cache key: an image is re-sent only when what it shows changes. */
export const wordKey = (b: BigLayout) => `${b.glyph}|${b.word}`
export const amountKey = (b: BigLayout) => `${b.amount}|${b.sub}`

// --- pixels -----------------------------------------------------------------

/** RGBA -> 4-bit grey level (0 = off, 15 = brightest) per pixel. Alpha composited over black. */
export function rgbaToGray4(rgba: ArrayLike<number>, w: number, h: number): Uint8Array {
  if (rgba.length < w * h * 4) throw new Error('rgbaToGray4: buffer too small')
  const out = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const a = rgba[i * 4 + 3]! / 255
    const y = (0.299 * rgba[i * 4]! + 0.587 * rgba[i * 4 + 1]! + 0.114 * rgba[i * 4 + 2]!) * a
    out[i] = Math.max(0, Math.min(15, Math.round((y / 255) * 15)))
  }
  return out
}

let crcTable: Uint32Array | undefined
function crc32(bytes: Uint8Array, init = 0xffffffff): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let c = init
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8)
  return c
}

function adler32(bytes: Uint8Array): number {
  let a = 1, b = 0
  for (let i = 0; i < bytes.length; i++) { a = (a + bytes[i]!) % 65521; b = (b + a) % 65521 }
  return ((b << 16) | a) >>> 0
}

const u32 = (n: number) => Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255)

function chunk(type: string, data: Uint8Array): Uint8Array {
  const t = Uint8Array.from(type, (c) => c.charCodeAt(0))
  const body = new Uint8Array(4 + data.length)
  body.set(t, 0); body.set(data, 4)
  const out = new Uint8Array(12 + data.length)
  out.set(u32(data.length), 0); out.set(body, 4); out.set(u32((crc32(body) ^ 0xffffffff) >>> 0), 8 + data.length)
  return out
}

/** zlib stream using stored (uncompressed) deflate blocks: no zlib dependency, ~10 KB for 200x96. */
function zlibStored(raw: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = [Uint8Array.of(0x78, 0x01)]
  for (let off = 0; off < raw.length || off === 0; off += 65535) {
    const part = raw.subarray(off, Math.min(raw.length, off + 65535))
    const final = off + 65535 >= raw.length ? 1 : 0
    const hdr = Uint8Array.of(final, part.length & 255, part.length >>> 8, ~part.length & 255, (~part.length >>> 8) & 255)
    blocks.push(hdr, part)
    if (final) break
  }
  blocks.push(u32(adler32(raw)))
  const out = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0))
  let p = 0
  for (const b of blocks) { out.set(b, p); p += b.length }
  return out
}

/** 4-bit indexed PNG (colour type 3, bit depth 4) with a 16-step grey palette. `levels` are 0..15 per pixel. */
export function encodePng4(levels: Uint8Array, w: number, h: number): Uint8Array {
  if (levels.length !== w * h) throw new Error('encodePng4: size mismatch')
  const rowBytes = Math.ceil(w / 2)
  const raw = new Uint8Array((rowBytes + 1) * h) // filter byte 0 + packed row
  for (let y = 0; y < h; y++) {
    const o = y * (rowBytes + 1)
    for (let x = 0; x < w; x++) {
      const v = levels[y * w + x]! & 15
      raw[o + 1 + (x >> 1)]! |= x & 1 ? v : v << 4
    }
  }
  const ihdr = new Uint8Array(13)
  ihdr.set(u32(w), 0); ihdr.set(u32(h), 4)
  ihdr[8] = 4; ihdr[9] = 3 // depth 4, indexed
  const plte = new Uint8Array(48)
  for (let i = 0; i < 16; i++) plte.fill(Math.round((i / 15) * 255), i * 3, i * 3 + 3)
  const parts = [
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk('IHDR', ihdr), chunk('PLTE', plte), chunk('IDAT', zlibStored(raw)), chunk('IEND', new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let p = 0
  for (const b of parts) { out.set(b, p); p += b.length }
  return out
}

// --- drawing ----------------------------------------------------------------

/** The subset of CanvasRenderingContext2D we use (so tests can pass a recording fake). */
export interface Ctx2D {
  fillStyle: string | CanvasGradient | CanvasPattern
  strokeStyle: string | CanvasGradient | CanvasPattern
  lineWidth: number
  lineCap: CanvasLineCap
  lineJoin: CanvasLineJoin
  font: string
  textBaseline: CanvasTextBaseline
  fillRect(x: number, y: number, w: number, h: number): void
  fillText(t: string, x: number, y: number): void
  measureText(t: string): { width: number }
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  closePath(): void
  arc(x: number, y: number, r: number, a0: number, a1: number): void
  stroke(): void
  fill(): void
}

const FONT = '"Arial Black", "Helvetica Neue", Arial, sans-serif'

/** Largest font size in [minPx, maxPx] whose text fits maxW. */
export function fitFont(ctx: Ctx2D, text: string, maxPx: number, minPx: number, maxW: number): number {
  for (let px = maxPx; px > minPx; px -= 2) {
    ctx.font = `bold ${px}px ${FONT}`
    if (ctx.measureText(text).width <= maxW) return px
  }
  return minPx
}

function clear(ctx: Ctx2D, w: number, h: number) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'
}

/** Draw a status glyph into a size x size box at (x, y). Fonts have no check mark, so these are paths. */
export function drawGlyph(ctx: Ctx2D, glyph: Glyph, x: number, y: number, size: number) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'
  const u = size / 64
  const P = (px: number, py: number) => [x + px * u, y + py * u] as const
  ctx.lineWidth = 9 * u
  ctx.beginPath()
  switch (glyph) {
    case 'check': {
      ctx.moveTo(...P(6, 34)); ctx.lineTo(...P(24, 54)); ctx.lineTo(...P(58, 8)); ctx.stroke(); break
    }
    case 'warn': {
      ctx.lineWidth = 6 * u
      ctx.moveTo(...P(32, 4)); ctx.lineTo(...P(60, 56)); ctx.lineTo(...P(4, 56)); ctx.closePath(); ctx.stroke()
      ctx.lineWidth = 7 * u
      ctx.beginPath(); ctx.moveTo(...P(32, 21)); ctx.lineTo(...P(32, 40)); ctx.stroke()
      ctx.beginPath(); ctx.arc(...P(32, 49), 3.5 * u, 0, Math.PI * 2); ctx.fill()
      break
    }
    case 'wait': {
      ctx.lineWidth = 6 * u
      ctx.arc(...P(32, 32), 26 * u, 0, Math.PI * 2); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(...P(32, 16)); ctx.lineTo(...P(32, 33)); ctx.lineTo(...P(44, 40)); ctx.stroke()
      break
    }
    case 'question': {
      ctx.font = `bold ${Math.round(60 * u)}px ${FONT}`; ctx.textBaseline = 'top'
      ctx.fillText('?', ...P(18, 0))
      break
    }
  }
}

/** Status word image: glyph at left, word fitted to the rest. */
export function drawWordImage(ctx: Ctx2D, b: BigLayout, w = IMG_W, h = IMG_H) {
  clear(ctx, w, h)
  const gs = 64
  drawGlyph(ctx, b.glyph, 6, (h - gs) / 2, gs)
  const tx = 6 + gs + 10
  const px = fitFont(ctx, b.word, 48, 18, w - tx - 2)
  ctx.font = `bold ${px}px ${FONT}`; ctx.textBaseline = 'middle'
  ctx.fillText(b.word, tx, h / 2 + 2)
}

/** Amount image: the number big, a small second line beneath. */
export function drawAmountImage(ctx: Ctx2D, b: BigLayout, w = IMG_W, h = IMG_H) {
  clear(ctx, w, h)
  const hasSub = b.sub !== ''
  const px = fitFont(ctx, b.amount, 44, 20, w - 8)
  ctx.font = `bold ${px}px ${FONT}`; ctx.textBaseline = 'middle'
  ctx.fillText(b.amount, 4, hasSub ? 34 : h / 2)
  if (hasSub) {
    const sp = fitFont(ctx, b.sub, 24, 14, w - 8)
    ctx.font = `bold ${sp}px ${FONT}`
    ctx.fillText(b.sub, 4, 74)
  }
}

export type ImageFactory = (w: number, h: number) => { ctx: Ctx2D; read: () => ArrayLike<number> }

/** Browser canvas -> factory. Throws when no canvas exists (callers fall back to text). */
export function browserImageFactory(): ImageFactory {
  return (w, h) => {
    const c: any = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : (() => {
      const el = document.createElement('canvas'); el.width = w; el.height = h; return el
    })()
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('no 2d canvas')
    return { ctx, read: () => ctx.getImageData(0, 0, w, h).data }
  }
}

export function renderWordPng(b: BigLayout, make: ImageFactory = browserImageFactory()): Uint8Array {
  const { ctx, read } = make(IMG_W, IMG_H)
  drawWordImage(ctx, b)
  return encodePng4(rgbaToGray4(read(), IMG_W, IMG_H), IMG_W, IMG_H)
}
export function renderAmountPng(b: BigLayout, make: ImageFactory = browserImageFactory()): Uint8Array {
  const { ctx, read } = make(IMG_W, IMG_H)
  drawAmountImage(ctx, b)
  return encodePng4(rgbaToGray4(read(), IMG_W, IMG_H), IMG_W, IMG_H)
}
