// Input normalization. Pure; no SDK imports so it is unit-testable.
// Gotchas: CLICK is eventType 0 and JSON/protobuf drops zero values, so an
// envelope that exists but has no eventType IS a click. Hardware sends
// sysEvent; the simulator sends textEvent/listEvent. Audio comes in audioEvent.
export type Input =
  | { kind: 'tap' }
  | { kind: 'double' }
  | { kind: 'up' }
  | { kind: 'down' }
  | { kind: 'pcm'; pcm: Uint8Array }
  | { kind: 'exit' }
  | { kind: 'none' }

const CLICK = 0, TOP = 1, BOTTOM = 2, DOUBLE = 3, ABNORMAL = 6, SYS_EXIT = 7

const NAMES: Record<string, number> = {
  CLICK_EVENT: 0, CLICK: 0, SCROLL_TOP_EVENT: 1, SCROLL_TOP: 1,
  SCROLL_BOTTOM_EVENT: 2, SCROLL_BOTTOM: 2, DOUBLE_CLICK_EVENT: 3, DOUBLE_CLICK: 3,
  ABNORMAL_EXIT_EVENT: 6, SYSTEM_EXIT_EVENT: 7,
}

/** Envelope present but eventType missing/null => CLICK (0). */
export function eventTypeOf(env: any): number | null {
  if (env === undefined || env === null || typeof env !== 'object') return null
  const t = env.eventType
  if (t === undefined || t === null) return CLICK
  if (typeof t === 'string') return t in NAMES ? NAMES[t] : null
  return typeof t === 'number' ? t : null
}

export function toBytes(raw: unknown): Uint8Array | null {
  if (raw instanceof Uint8Array) return raw
  if (Array.isArray(raw)) return Uint8Array.from(raw as number[])
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      const bin = atob(raw)
      const out = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
      return out
    } catch { return null }
  }
  return null
}

export function normalizeEvent(event: any): Input {
  if (!event) return { kind: 'none' }
  const pcm = toBytes(event.audioEvent?.audioPcm)
  if (pcm) return { kind: 'pcm', pcm }
  // Priority: sysEvent (hardware), then textEvent / listEvent (simulator).
  for (const env of [event.sysEvent, event.textEvent, event.listEvent]) {
    const t = eventTypeOf(env)
    if (t === null) continue
    if (t === DOUBLE) return { kind: 'double' }
    if (t === CLICK) return { kind: 'tap' }
    if (t === TOP) return { kind: 'up' }
    if (t === BOTTOM) return { kind: 'down' }
    if (t === SYS_EXIT || t === ABNORMAL) return { kind: 'exit' }
  }
  return { kind: 'none' }
}

/** One swipe fires 5-10 scroll events; pass at most one per `ms`. */
export function makeDebouncer(ms = 300, now: () => number = Date.now) {
  let last = -Infinity
  return (): boolean => {
    const t = now()
    if (t - last < ms) return false
    last = t
    return true
  }
}
