import { afterEach, expect, it, vi } from 'vitest'
import * as api from './api'

afterEach(() => { vi.unstubAllGlobals(); api.setDeviceSecret('') })

it('sends the device secret header on every call once set, and never puts it in the URL', async () => {
  const seen: { url: string; headers: Record<string, string> }[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    seen.push({ url, headers: (init.headers ?? {}) as Record<string, string> })
    return new Response(JSON.stringify({ state: 'IDLE' }), { status: 200 })
  })
  await api.status('dev-1')
  expect(seen[0]!.headers['x-device-secret']).toBeUndefined()
  api.setDeviceSecret('s3cret')
  await api.status('dev-1')
  await api.arm('dev-1', '5.00', 'USDT')
  await api.stt('dev-1', new Uint8Array([1, 2, 3]))
  for (const s of seen.slice(1)) {
    expect(s.headers['x-device-secret']).toBe('s3cret')
    expect(s.url).not.toContain('s3cret')
  }
})

it('403 from the server surfaces as NotPairedError so the glasses re-pair', async () => {
  vi.stubGlobal('fetch', async () => new Response('{}', { status: 403 }))
  await expect(api.status('dev-1')).rejects.toBeInstanceOf(api.NotPairedError)
})
