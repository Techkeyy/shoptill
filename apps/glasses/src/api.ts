import type { Status } from './screens'
import * as mock from './mock'

export const API = (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:8787'
const MOCK = import.meta.env.VITE_MOCK === '1'

export class NetError extends Error {}
/** Server no longer knows this device (403) or its shop setup is unfinished (409): re-pair. */
export class NotPairedError extends Error {}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  if (MOCK) return mock.handle(path, body) as T
  let res: Response
  try {
    res = await fetch(API + path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch (e) { throw new NetError(String(e)) }
  if (res.status === 403 || res.status === 409) throw new NotPairedError(`HTTP ${res.status}`)
  if (!res.ok) throw new NetError(`HTTP ${res.status}`)
  return (await res.json()) as T
}

const q = (id: string) => `?deviceId=${encodeURIComponent(id)}`

export const pair = (deviceId: string) =>
  call<{ paired: boolean; code?: string; shopName?: string }>('POST', '/api/device/pair', { deviceId })
export const arm = (deviceId: string, amount: string, asset: 'USDT' | 'GRAM') =>
  call<{ saleId: string }>('POST', '/api/till/arm', { deviceId, amount, asset })
export const status = (deviceId: string) =>
  call<Status>('GET', '/api/till/status' + q(deviceId))
export const voidSale = (deviceId: string, saleId: string) =>
  call<unknown>('POST', '/api/till/void', { deviceId, saleId })
export const receipt = (deviceId: string, saleId: string) =>
  call<unknown>('POST', '/api/till/receipt', { deviceId, saleId })
export const attach = (deviceId: string, saleId: string, paymentId: string) =>
  call<unknown>('POST', '/api/till/attach', { deviceId, saleId, paymentId })
export const today = (deviceId: string) =>
  call<{ count: number; total: string; asset: string }>('GET', '/api/today' + q(deviceId))

export async function stt(deviceId: string, wav: Uint8Array): Promise<{ text: string; amount: string | null; asset?: string }> {
  if (MOCK) return mock.stt()
  let res: Response
  try {
    res = await fetch(`${API}/api/stt${q(deviceId)}`, { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: new Blob([wav as BlobPart], { type: "audio/wav" }) })
  } catch (e) { throw new NetError(String(e)) }
  if (res.status === 403 || res.status === 409) throw new NotPairedError(`HTTP ${res.status}`)
  if (!res.ok) throw new NetError(`HTTP ${res.status}`)
  return res.json()
}
