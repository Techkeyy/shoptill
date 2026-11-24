import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { createApi } from './api.ts';

it('serves the Mini App, icon and manifest; blocks traversal', async () => {
  // A small committed fixture, not apps/pay/dist (build output, absent on a fresh clone).
  const payDir = resolve(__dirname, '../test/fixtures/pay');
  const api = createApi({ svc: {} as any, bot: {} as any, cfg: { payDir, publicUrl: 'https://x.test', botToken: 't' } as any });
  const get = (path: string) => api({ method: 'GET', path, query: new URLSearchParams(), headers: {}, body: Buffer.alloc(0) });
  expect((await get('/pay/')).headers['content-type']).toContain('text/html');
  expect((await get('/icon.png')).headers['content-type']).toBe('image/png');
  expect(JSON.parse(String((await get('/tonconnect-manifest.json')).body))).toMatchObject({ name: 'ShopTill', iconUrl: 'https://x.test/icon.png' });
  expect((await get('/pay/../package.json')).status).toBe(404);
  expect((await get('/pay/%2e%2e/package.json')).status).toBe(404);
});
