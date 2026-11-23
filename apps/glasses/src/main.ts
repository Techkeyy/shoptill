// Started from even-realities/evenhub-templates/asr (see ORIGIN.md).
import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  TextContainerUpgrade,
} from '@evenrealities/even_hub_sdk'
import * as api from './api'
import { makeDebouncer, normalizeEvent } from './events'
import { PRESETS, render, type Screen, type Status, type View } from './screens'
import { encodeWav } from './wav'

const ASSET = 'USDT' as const
const LISTEN_MS = 6000
const POLL_MS = 2000
const OPEN_STATES = ['WAITING', 'SHORT']
const VOIDABLE = ['WAITING', 'SHORT', 'FAKE', 'UNMATCHED']

const bridge = await waitForEvenAppBridge()

const mk = (id: number, name: string, y: number, h: number, content: string, cap = 0) =>
  new TextContainerProperty({
    xPosition: 0, yPosition: y, width: 576, height: h, borderWidth: 0, borderColor: 5,
    paddingLength: 6, containerID: id, containerName: name, content, isEventCapture: cap,
  })
// Exactly one capture container (the big status word).
const created = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: 3,
    textObject: [mk(1, 'l1', 0, 110, 'ShopTill', 1), mk(2, 'l2', 110, 90, ''), mk(3, 'l3', 200, 88, '')],
  }),
)
if (created !== 0) console.error('createStartUpPageContainer failed', created)

// --- rendering: textContainerUpgrade only for lines that changed -----------
const shown: Screen = { l1: 'ShopTill', l2: '', l3: '' }
async function show(view: View) {
  const sc = render(view)
  for (const [i, k] of [[1, 'l1'], [2, 'l2'], [3, 'l3']] as const) {
    if (sc[k] === shown[k]) continue
    shown[k] = sc[k]
    await bridge.textContainerUpgrade(
      new TextContainerUpgrade({ containerID: i, containerName: k, content: sc[k] }),
    )
  }
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
const deviceId = await getDeviceId()

// --- state ------------------------------------------------------------------
type Mode = 'pair' | 'idle' | 'listening' | 'preset' | 'sale' | 'info'
let mode: Mode = 'pair'
let presetIdx = 2
let saleId: string | null = null
let last: Status | null = null
let paymentId: string | null = null
let pollTimer: number | undefined
let listenTimer: number | undefined
let chunks: Uint8Array[] = []
let micOn = false

function goIdle() {
  mode = 'idle'; saleId = null; last = null; stopPoll()
  void show({ v: 'idle' })
}
function flash(text: string, hint?: string, ms = 2000) {
  mode = 'info'
  void show({ v: 'msg', text, hint: hint ?? '' })
  window.setTimeout(() => { if (mode === 'info') goIdle() }, ms)
}

// --- pairing ----------------------------------------------------------------
async function doPair() {
  try {
    const r = await api.pair(deviceId)
    if (r.paired) return goIdle()
    mode = 'pair'
    void show({ v: 'pair', code: r.code })
  } catch {
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
    if (st.unmatched) paymentId = st.unmatched.paymentId
    if (st.state === 'IDLE' || st.state === 'VOID') return goIdle()
    void show({ v: 'sale', status: st })
    // Polling continues only while the sale is open and unresolved.
    if (OPEN_STATES.includes(st.state)) schedulePoll()
  } catch {
    void show({ v: 'offline' })
    schedulePoll()
  }
}

async function arm(amount: string) {
  try {
    const r = await api.arm(deviceId, amount, ASSET)
    saleId = r.saleId; mode = 'sale'
    void show({ v: 'sale', status: { state: 'WAITING', sale: { saleId, amount, asset: ASSET } } })
    schedulePoll()
  } catch {
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
    if (r.amount) await arm(Number(r.amount).toFixed(2))
    else flash("Didn't catch that - try again", 'tap: speak', 2500)
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
    case 'preset': return arm(PRESETS[presetIdx].toFixed(2))
    case 'info': return goIdle()
    case 'sale': {
      const st = last?.state
      if (st === 'PAID' || st === 'EXTRA') {
        try { if (saleId) await api.receipt(deviceId, saleId) } catch { return flash('Offline - retry', 'tap again', 2000) }
        return flash('RECEIPT SENT', '', 1800)
      }
      if (st === 'UNMATCHED' && saleId && paymentId) {
        try { await api.attach(deviceId, saleId, paymentId) } catch { /* poll will show truth */ }
        mode = 'sale'; return void poll()
      }
      if (st === 'FAKE') { void show({ v: 'sale', status: { state: 'WAITING', sale: last?.sale } }); return schedulePoll() }
      if (st === 'DUPLICATE' || st === 'LATE') return goIdle()
      return
    }
  }
}

async function onDouble() {
  if (mode === 'idle' || mode === 'pair') { void bridge.shutDownPageContainer(1); return }
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
  if (!scrollOk()) return
  if (mode === 'idle' && dir === 'down') {
    try { const t = await api.today(deviceId); mode = 'info'; void show({ v: 'today', ...t }) } catch { flash('Offline - retrying', '', 2000) }
    return
  }
  if (mode === 'idle' || mode === 'preset') {
    presetIdx = (presetIdx + (dir === 'up' ? 1 : PRESETS.length - 1)) % PRESETS.length
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
