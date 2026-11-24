// Started from even-realities/evenhub-templates/asr (see ORIGIN.md).
import {
  RebuildPageContainer,
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  TextContainerUpgrade,
  ImageContainerProperty,
  ImageRawDataUpdate,
  ImageRawDataUpdateResult,
} from '@evenrealities/even_hub_sdk'
import * as api from './api'
import { makeDebouncer, normalizeEvent } from './events'
import { GEOM, amountKey, bigLayout, renderAmountPng, renderWordPng, wordKey, type BigLayout } from './bigtype'
import { PRESETS, amountDiffers, nextPreset, render, type Screen, type Status, type View } from './screens'
import { encodeWav } from './wav'

const ASSET = 'USDT' as const
const LISTEN_MS = 6000
const POLL_MS = 2000
// Keep polling while the sale can still change. FAKE and UNMATCHED stay open: the honest payment
// often arrives right after a fake token or a stray transfer, and the seller must see PAID.
const OPEN_STATES = ['WAITING', 'SHORT', 'CONFIRMING', 'FAKE', 'UNMATCHED']
const VOIDABLE = ['WAITING', 'SHORT', 'FAKE', 'UNMATCHED']

const bridge = await waitForEvenAppBridge()

const mk = (id: number, name: string, y: number, h: number, content: string, cap = 0) =>
  new TextContainerProperty({
    xPosition: 0, yPosition: y, width: 576, height: h, borderWidth: 0, borderColor: 5,
    paddingLength: 6, containerID: id, containerName: name, content, isEventCapture: cap,
  })
// Exactly one capture container (the big status word).
const layout = () => [mk(1, 'l1', 0, 110, 'ShopTill', 1), mk(2, 'l2', 110, 90, ''), mk(3, 'l3', 200, 88, '')]
const created = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({ containerTotalNum: 3, textObject: layout() }),
)
if (created !== 0) {
  // The page already exists (app reloaded in the same host session): rebuild it so no
  // stale text from the previous run stays on screen.
  console.warn('createStartUpPageContainer returned', created, '- rebuilding page')
  await bridge.rebuildPageContainer(new RebuildPageContainer({ containerTotalNum: 3, textObject: layout() }))
}

// --- rendering --------------------------------------------------------------
// Two page layouts. 'text': three text containers (idle/pair/listening and the fallback).
// 'big': two 200x96 image containers (status word + glyph, amount) over two text lines.
// Images cannot be sent in createStartUpPageContainer, so big mode = rebuildPageContainer with
// the image containers, a short wait, then updateImageRawData (one at a time, never concurrent).
// Any failure falls back to the text layout, so the screen is never blank or stuck.
const shown: Screen = { l1: 'ShopTill', l2: '', l3: '' }
let layoutMode: 'text' | 'big' = 'text'
let imgShown: { word?: string; amount?: string } = {}
let bigFails = 0
const BIG_MAX_FAILS = 2
const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms))

const bigText = (id: number, name: string, y: number, h: number, content: string, cap = 0) => mk(id, name, y, h, content, cap)
const bigImages = () => [GEOM.word, GEOM.amount].map((g) => new ImageContainerProperty({
  xPosition: g.x, yPosition: g.y, width: g.w, height: g.h, containerID: g.id, containerName: g.name,
}))

async function toTextLayout() {
  await bridge.rebuildPageContainer(new RebuildPageContainer({ containerTotalNum: 3, textObject: [mk(1, 'l1', 0, 110, '', 1), mk(2, 'l2', 110, 90, ''), mk(3, 'l3', 200, 88, '')] }))
  layoutMode = 'text'; imgShown = {}
  shown.l1 = ''; shown.l2 = ''; shown.l3 = ''
}
async function toBigLayout(b: BigLayout) {
  const ok = await bridge.rebuildPageContainer(new RebuildPageContainer({
    containerTotalNum: 4,
    textObject: [
      bigText(GEOM.detail.id, GEOM.detail.name, GEOM.detail.y, GEOM.detail.h, b.detail, 1),
      bigText(GEOM.hint.id, GEOM.hint.name, GEOM.hint.y, GEOM.hint.h, b.hint),
    ],
    imageObject: bigImages(),
  }))
  if (!ok) throw new Error('rebuild to big layout refused')
  layoutMode = 'big'; imgShown = {}
  shown.l1 = b.detail; shown.l2 = b.hint; shown.l3 = ''
  await sleep(100) // the host needs a moment to allocate the image containers
}
async function sendImage(g: { id: number; name: string }, png: Uint8Array) {
  const r = await bridge.updateImageRawData(new ImageRawDataUpdate({ containerID: g.id, containerName: g.name, imageData: Array.from(png) }))
  if (!ImageRawDataUpdateResult.isSuccess(r)) throw new Error(`image update failed: ${String(r)}`)
}

// Serialize renders: overlapping show() calls raced and left a stale line on screen
// (UAT 2026-11-23: "Offline" title stuck above the pairing code).
let renderChain: Promise<void> = Promise.resolve()
function show(view: View): Promise<void> {
  renderChain = renderChain.then(() => paint(view)).catch(() => {})
  return renderChain
}
async function paintText(sc: Screen) {
  for (const [i, k] of [[1, 'l1'], [2, 'l2'], [3, 'l3']] as const) {
    if (sc[k] === shown[k]) continue
    shown[k] = sc[k]
    await bridge.textContainerUpgrade(
      new TextContainerUpgrade({ containerID: i, containerName: k, content: sc[k] }),
    )
  }
}
async function paintBig(b: BigLayout) {
  if (layoutMode !== 'big') await toBigLayout(b)
  for (const [i, k, v] of [[1, 'l1', b.detail], [2, 'l2', b.hint]] as const) {
    if (shown[k] === v) continue
    shown[k] = v
    await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: i, containerName: k, content: v }))
  }
  const wk = wordKey(b), ak = amountKey(b)
  if (imgShown.word !== wk) { await sendImage(GEOM.word, renderWordPng(b)); imgShown.word = wk }
  if (imgShown.amount !== ak) { await sendImage(GEOM.amount, renderAmountPng(b)); imgShown.amount = ak }
}
async function paint(view: View) {
  const big = bigFails >= BIG_MAX_FAILS ? null : bigLayout(view)
  if (big) {
    try { await paintBig(big); bigFails = 0; return } catch (e) {
      bigFails++
      console.warn('big-type render failed, falling back to text', e)
      // fall through to the text rendering below
    }
  }
  try {
    if (layoutMode === 'big') await toTextLayout()
  } catch (e) { console.warn('rebuild to text layout failed', e) }
  await paintText(render(view))
}

// --- device identity --------------------------------------------------------
async function getDeviceId(): Promise<string> {
  try {
    const existing = await bridge.getLocalStorage('deviceId')
    if (existing) return existing
  } catch { /* fall through and mint one */ }
  const id = crypto.randomUUID()
  try { await bridge.setLocalStorage('deviceId', id) } catch { /* non-fatal */ }
  return id
}
let deviceId = await getDeviceId()
// Device secret: issued once by the server at first pair, required on every call afterwards.
async function loadSecret() {
  try { api.setDeviceSecret((await bridge.getLocalStorage('deviceSecret')) || '') } catch { /* none yet */ }
}
await loadSecret()
async function saveSecret(s: string) {
  api.setDeviceSecret(s)
  try { await bridge.setLocalStorage('deviceSecret', s) } catch { /* non-fatal: server re-issues while unpaired */ }
}
/** The server refuses this device (paired, but our secret is gone): start over with a fresh identity. */
async function resetIdentity() {
  deviceId = crypto.randomUUID()
  try { await bridge.setLocalStorage('deviceId', deviceId) } catch { /* ignore */ }
  await saveSecret('')
}

// --- state ------------------------------------------------------------------
type Mode = 'pair' | 'idle' | 'listening' | 'confirm' | 'preset' | 'sale' | 'info'
let mode: Mode = 'pair'
let presetIdx = -1 // -1 = not in preset mode; first swipe lands on PRESETS[0]
let saleId: string | null = null
let last: Status | null = null
let paymentId: string | null = null
let pollTimer: number | undefined
let listenTimer: number | undefined
let chunks: Uint8Array[] = []
let micOn = false
let heard: { amount: string; asset: Asset } | null = null // voice result waiting for the seller's tap
let attachConfirmed = false // second tap needed when the unmatched amount differs from the sale

function goIdle() {
  mode = 'idle'; saleId = null; last = null; presetIdx = -1; stopPoll()
  void show({ v: 'idle' })
}
function flash(text: string, hint?: string, ms = 2000, sub?: string) {
  mode = 'info'
  void show({ v: 'msg', text, sub, hint: hint ?? '' })
  window.setTimeout(() => { if (mode === 'info') goIdle() }, ms)
}

// --- pairing ----------------------------------------------------------------
async function doPair() {
  try {
    const r = await api.pair(deviceId)
    if (r.deviceSecret) await saveSecret(r.deviceSecret)
    if (r.paired) return goIdle()
    mode = 'pair'
    void show({ v: 'pair', code: r.code })
  } catch (e) {
    if (e instanceof api.NotPairedError) await resetIdentity()
    mode = 'pair'
    void show({ v: 'offline' })
  }
  if (mode === 'pair') window.setTimeout(doPair, 3000)
}

// --- sale + polling ---------------------------------------------------------
function stopPoll() { if (pollTimer !== undefined) { clearTimeout(pollTimer); pollTimer = undefined } }
function schedulePoll() { stopPoll(); pollTimer = window.setTimeout(poll, POLL_MS) }

async function poll() {
  if (mode !== 'sale') return
  try {
    const st = await api.status(deviceId)
    if (mode !== 'sale') return
    last = st
    if (st.sale) saleId = st.sale.saleId
    if (st.unmatched) { if (paymentId !== st.unmatched.paymentId) attachConfirmed = false; paymentId = st.unmatched.paymentId }
    if (st.state === 'IDLE' || st.state === 'VOID') return goIdle()
    void show({ v: 'sale', status: st, confirmAttach: st.state === 'UNMATCHED' && attachConfirmed })
    // Polling continues only while the sale is open and unresolved.
    if (OPEN_STATES.includes(st.state)) schedulePoll()
  } catch (e) {
    if (e instanceof api.NotPairedError) { stopPoll(); return void doPair() }
    void show({ v: 'offline' })
    schedulePoll()
  }
}

type Asset = 'USDT' | 'GRAM'
async function arm(amount: string, asset: Asset = ASSET) {
  try {
    const r = await api.arm(deviceId, amount, asset)
    saleId = r.saleId; mode = 'sale'
    void show({ v: 'sale', status: { state: 'WAITING', sale: { saleId, amount, asset } } })
    schedulePoll()
  } catch (e) {
    if (e instanceof api.NotPairedError) return void doPair()
    flash('Offline - retrying', 'try again', 2500)
  }
}

// --- voice ------------------------------------------------------------------
async function startListening() {
  mode = 'listening'; chunks = []
  void show({ v: 'listening' })
  micOn = await bridge.audioControl(true) // only after createStartUpPageContainer
  listenTimer = window.setTimeout(() => void stopListening(), LISTEN_MS)
}
async function stopListening() {
  if (mode !== 'listening') return
  clearTimeout(listenTimer)
  if (micOn) { await bridge.audioControl(false); micOn = false }
  const wav = encodeWav(chunks)
  chunks = []
  mode = 'info'
  void show({ v: 'msg', text: 'Thinking...', hint: '' })
  try {
    const r = await api.stt(deviceId, wav)
    // Spoken currency wins ("five gram" -> GRAM); default USDT.
    // Never arm straight from speech: show what was heard and wait for a tap,
    // so a misheard price never reaches the customer.
    if (r.amount) {
      heard = { amount: Number(r.amount).toFixed(2), asset: r.asset === 'GRAM' ? 'GRAM' : 'USDT' }
      mode = 'confirm'
      void show({ v: 'confirm', ...heard, heard: r.text ?? '' })
    } else flash("Didn't catch that - try again", 'tap: speak', 3000, r.text ? `heard: "${r.text}"` : undefined)
  } catch {
    flash('Offline - retrying', 'try again', 2500)
  }
}

// --- input ------------------------------------------------------------------
const scrollOk = makeDebouncer(300)

async function onTap() {
  switch (mode) {
    case 'pair': return
    case 'idle': return startListening()
    case 'listening': return stopListening()
    case 'confirm': { const h = heard; heard = null; return h ? arm(h.amount, h.asset) : goIdle() }
    case 'preset': return arm(PRESETS[Math.max(0, presetIdx)].toFixed(2))
    case 'info': return goIdle()
    case 'sale': {
      const st = last?.state
      if (st === 'PAID' || st === 'EXTRA') {
        try { if (saleId) await api.receipt(deviceId, saleId) } catch { return flash('Offline - retry', 'tap again', 2000) }
        return flash('RECEIPT SENT', '', 2500, 'customer has it in Telegram')
      }
      if (st === 'UNMATCHED' && saleId && paymentId) {
        if (last && amountDiffers(last) && !attachConfirmed) {
          attachConfirmed = true
          return void show({ v: 'sale', status: last, confirmAttach: true })
        }
        attachConfirmed = false
        try { await api.attach(deviceId, saleId, paymentId) } catch { /* poll will show truth */ }
        mode = 'sale'; return void poll()
      }
      if (st === 'FAKE') return // stays on FAKE until a real payment arrives (polling continues); 2x tap cancels
      if (st === 'DUPLICATE' || st === 'LATE') return goIdle()
      return
    }
  }
}

async function onDouble() {
  if (mode === 'idle' || mode === 'pair') { void bridge.shutDownPageContainer(1); return }
  if (mode === 'confirm') { heard = null; return startListening() }
  if (mode === 'listening') { clearTimeout(listenTimer); if (micOn) { await bridge.audioControl(false); micOn = false }; return goIdle() }
  if (mode === 'sale') {
    // In READY this voids the sale; a paid sale is never voidable.
    if (last && VOIDABLE.includes(last.state) && saleId) { try { await api.voidSale(deviceId, saleId) } catch { /* server expires it */ } }
    else if (!last && saleId) { try { await api.voidSale(deviceId, saleId) } catch { /* ignore */ } }
    else if (last && !VOIDABLE.includes(last.state)) return
    return goIdle()
  }
  goIdle()
}

async function onScroll(dir: 'up' | 'down') {
  // Ignore scrolls that cannot act, BEFORE the debouncer: a swipe burst during pairing,
  // listening or a sale used to consume the 300 ms window and swallow the next real swipe.
  if (mode === 'pair' || mode === 'listening' || mode === 'confirm' || mode === 'sale') return
  if (!scrollOk()) return
  if (mode === 'idle' && dir === 'down') {
    try { const t = await api.today(deviceId); mode = 'info'; void show({ v: 'today', ...t }) } catch { flash('Offline - retrying', '', 2000) }
    return
  }
  if (mode === 'idle' || mode === 'preset') {
    presetIdx = nextPreset(presetIdx, dir)
    mode = 'preset'
    void show({ v: 'preset', amount: PRESETS[presetIdx], asset: ASSET })
    return
  }
  if (mode === 'info') goIdle()
}

const unsubscribe = bridge.onEvenHubEvent((event) => {
  const inp = normalizeEvent(event)
  switch (inp.kind) {
    case 'pcm': if (mode === 'listening') chunks.push(inp.pcm); break
    case 'tap': void onTap(); break
    case 'double': void onDouble(); break
    case 'up': void onScroll('up'); break
    case 'down': void onScroll('down'); break
    case 'exit': cleanup(); break
  }
})

function cleanup() {
  stopPoll(); clearTimeout(listenTimer)
  if (micOn) void bridge.audioControl(false)
  unsubscribe()
}
window.addEventListener('beforeunload', cleanup)

void doPair()
