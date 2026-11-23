import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Address } from '@ton/core';
import { normalizeAddress } from '@shoptill/core';
import type { IncomingPayment } from '@shoptill/core';
import { describe, expect, it } from 'vitest';
import { createApi } from './api.ts';
import { signInitData, signToken } from './auth.ts';
import { Bot } from './bot.ts';
import type { Config } from './config.ts';
import { openDb } from './db.ts';
import { RateLimiter } from './ratelimit.ts';
import { Till, type Chain } from './service.ts';
import type { Markup, Tg, Update } from './telegram.ts';

// Security regression tests from the 2026-11-23 audit (evidence/security-audit.md).

const BOT_TOKEN = '123456:TEST-TOKEN';
const addr = (n: number) => new Address(0, Buffer.alloc(32, n));
const SELLER = addr(1), CUSTOMER = addr(2), GOOD = addr(3), FAKE = addr(4), OTHER = addr(5);
const T0 = 1_800_000_000;

class FakeChain implements Chain {
  native: IncomingPayment[] = [];
  jettons: IncomingPayment[] = [];
  async getIncomingTransactions(_a: string, since: number) { return this.native.filter((p) => p.utime >= since); }
  async getJettonTransfersTo(a: string, since: number) {
    return this.jettons.filter((p) => p.utime >= since && (!(p as any).to || (p as any).to === normalizeAddress(a)));
  }
}
class FakeTg implements Tg {
  sent: { chat: number; text: string }[] = [];
  async me() { return { username: 'ShopTillBot' }; }
  async send(chat: number, text: string, _m?: Markup) { this.sent.push({ chat, text }); return this.sent.length; }
  async edit() {}
  async photo() {}
  async answerCb() {}
  async getUpdates(): Promise<Update[]> { return []; }
}
const cfg = (over: Partial<Config> = {}): Config => ({
  botToken: BOT_TOKEN, groqKey: '', tonKey: '', publicUrl: 'https://shoptill.test', port: 0, network: 'testnet',
  dbPath: ':memory:', payDir: '/nonexistent', usdt: { master: GOOD.toRawString(), decimals: 6 },
  jettonMasters: [GOOD.toRawString()], jettonDecimals: {}, ...over,
});
let seq = 0;
const jetton = (master: Address, comment: string | null, utime: number, amount = '12000000'): IncomingPayment => ({
  txHash: `tx${++seq}`, lt: String(1000 + seq), utime, success: true, from: normalizeAddress(CUSTOMER.toRawString()),
  asset: { kind: 'jetton', master: normalizeAddress(master.toRawString()) }, amountRaw: amount, decimals: 6, comment,
});
const msg = (chat: number, text: string): Update => ({ update_id: 1, message: { message_id: 1, chat: { id: chat, type: 'private' }, text } });

function env() {
  const chain = new FakeChain(), tg = new FakeTg();
  const clock = { ms: T0 * 1000 };
  const c = cfg();
  const svc = new Till({ db: openDb(':memory:'), cfg: c, ton: chain, tg, now: () => clock.ms, log: () => {} });
  const bot = new Bot(svc, tg, c, () => {});
  const api = createApi({ svc, bot, cfg: c });
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, ip = '1.1.1.1') => {
    const u = new URL(path, 'http://x');
    const r = await api({ method, path: u.pathname, query: u.searchParams, headers, ip, body: body ? Buffer.from(JSON.stringify(body)) : Buffer.alloc(0) });
    return { status: r.status, json: r.body && String(r.headers['content-type']).includes('json') ? JSON.parse(String(r.body)) : null, headers: r.headers };
  };
  return { chain, tg, clock, svc, bot, api, call };
}

/** a paired, ready device; returns its id + secret */
function pairedDevice(e: ReturnType<typeof env>, id = 'dev-A', chat = 555) {
  const p = e.svc.pair(id);
  const shop = e.svc.linkCode(chat, p.code!)!;
  e.svc.setShopName(shop, 'Bob');
  e.svc.setShopAddress(shop, SELLER.toRawString());
  return { id, secret: p.deviceSecret!, shop };
}

describe('device identity: deviceId alone controls nothing', () => {
  it('every device endpoint rejects a missing or wrong secret, accepts the right one', async () => {
    const e = env();
    const d = pairedDevice(e);
    const good = { 'x-device-secret': d.secret };
    const bad = { 'x-device-secret': 'nope' };
    const arm = { deviceId: d.id, amount: '5.00', asset: 'USDT' };
    for (const h of [{}, bad]) {
      expect((await e.call('POST', '/api/till/arm', arm, h)).status).toBe(403);
      expect((await e.call('GET', `/api/till/status?deviceId=${d.id}`, undefined, h)).status).toBe(403);
      expect((await e.call('GET', `/api/today?deviceId=${d.id}`, undefined, h)).status).toBe(403);
      expect((await e.call('POST', '/api/till/void', { deviceId: d.id, saleId: 'x' }, h)).status).toBe(403);
      expect((await e.call('POST', '/api/till/receipt', { deviceId: d.id, saleId: 'x' }, h)).status).toBe(403);
      expect((await e.call('POST', '/api/till/attach', { deviceId: d.id, saleId: 'x', paymentId: 'y' }, h)).status).toBe(403);
      expect((await e.call('POST', `/api/stt?deviceId=${d.id}`, undefined, h)).status).toBe(403);
    }
    expect((await e.call('POST', '/api/till/arm', arm, good)).status).toBe(200);
    expect((await e.call('GET', `/api/till/status?deviceId=${d.id}`, undefined, good)).json.state).toBe('WAITING');
  });

  it("one seller's secret does not open another seller's device", async () => {
    const e = env();
    const a = pairedDevice(e, 'dev-A', 1);
    const b = pairedDevice(e, 'dev-B', 2);
    expect((await e.call('GET', `/api/till/status?deviceId=${a.id}`, undefined, { 'x-device-secret': b.secret })).status).toBe(403);
  });

  it('knowing a paired deviceId does not let a stranger re-pair it', async () => {
    const e = env();
    const d = pairedDevice(e);
    const r = await e.call('POST', '/api/device/pair', { deviceId: d.id });
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.json)).not.toContain(d.secret);
    expect((await e.call('POST', '/api/device/pair', { deviceId: d.id }, { 'x-device-secret': d.secret })).json).toEqual({ paired: true, shopName: 'Bob' });
  });

  it('a legacy device row without a secret receives one on its next pair call', () => {
    const e = env();
    const p0 = e.svc.pair('old');
    (e.svc as any).d.db.prepare('UPDATE devices SET secret_hash=NULL WHERE device_id=?').run('old');
    const p1 = e.svc.pair('old');
    expect(p1.deviceSecret).toBeTruthy();
    expect(p1.code).toBe(p0.code);
    expect(() => e.svc.authDevice('old', p1.deviceSecret)).not.toThrow();
  });

  it('pair endpoint is rate limited per client ip', async () => {
    const e = env();
    let last = 0;
    for (let i = 0; i < 130; i++) last = (await e.call('POST', '/api/device/pair', { deviceId: `d${i}` }, {}, '9.9.9.9')).status;
    expect(last).toBe(429);
    expect((await e.call('POST', '/api/device/pair', { deviceId: 'fresh' }, {}, '8.8.8.8')).status).toBe(200);
  });
});

describe('pairing code cannot be brute forced or hijacked', () => {
  it('codes are 6 digits and expire when the glasses stop showing them', () => {
    const e = env();
    const p = e.svc.pair('x');
    expect(p.code).toMatch(/^TILL-\d{6}$/);
    e.clock.ms += 31 * 60_000;
    expect(e.svc.linkCode(1, p.code!)).toBeNull();
    const p2 = e.svc.pair('x', p.deviceSecret); // glasses ask again -> fresh code
    expect(p2.code).not.toBeNull();
    expect(e.svc.linkCode(1, p2.code!)).not.toBeNull();
  });

  it('locks a chat out after 5 wrong codes, even for the right code afterwards', async () => {
    const e = env();
    const victim = e.svc.pair('victim');
    for (let i = 0; i < 5; i++) {
      await e.bot.handle(msg(666, `TILL-00000${i}`));
      expect(e.tg.sent.at(-1)!.text).toContain('do not know');
    }
    await e.bot.handle(msg(666, victim.code!));
    expect(e.tg.sent.at(-1)!.text).toContain('Too many wrong codes');
    expect(e.svc.sellerShop(666)).toBeUndefined();
    // the real owner (different chat) is unaffected and the lock expires
    expect(e.svc.tryLink(777, victim.code!)).toMatchObject({ shopId: expect.any(Number) });
    e.clock.ms += 11 * 60_000;
    expect(e.svc.tryLink(666, 'TILL-000000')).toBe('bad');
  });

  it('a global failure budget stops distributed guessing from many chats', () => {
    const e = env();
    const victim = e.svc.pair('victim');
    for (let chat = 1; chat <= 100; chat++) expect(e.svc.tryLink(chat, `TILL-${String(chat).padStart(6, '0')}`)).toBe('bad');
    expect(e.svc.tryLink(5000, victim.code!)).toBe('locked');
  });
});

describe('setup link ownership', () => {
  it('a setup token minted for chat A cannot set the address of a shop owned by chat B', async () => {
    const e = env();
    const d = pairedDevice(e, 'dev-A', 100);
    const init = signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 200 }) }, BOT_TOKEN);
    const forged = signToken({ k: 'setup', chat: 200, shop: d.shop, exp: Math.floor(Date.now() / 1000) + 600 }, BOT_TOKEN);
    const r = await e.call('POST', '/api/shop/address', { t: forged, address: OTHER.toRawString() }, { 'x-tg-init-data': init });
    expect(r.status).toBe(401);
    expect(e.svc.shop(d.shop).address).toBe(SELLER.toRawString());
    // the shop owner can still change it
    const initOwner = signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 100 }) }, BOT_TOKEN);
    const ok = signToken({ k: 'setup', chat: 100, shop: d.shop, exp: Math.floor(Date.now() / 1000) + 600 }, BOT_TOKEN);
    expect((await e.call('POST', '/api/shop/address', { t: ok, address: OTHER.toRawString() }, { 'x-tg-init-data': initOwner })).status).toBe(200);
  });
});

describe('state only moves on chain data', () => {
  it('attach cannot make a FAKE-token payment PAID, and a payment cannot be attached twice', async () => {
    const e = env();
    const d = pairedDevice(e);
    let { saleId } = e.svc.arm(d.id, '12.00', 'USDT');
    e.chain.jettons.push(jetton(FAKE, null, T0 + 5)); // fake master, no ref
    await e.svc.tick();
    expect(e.svc.status(d.id).state).not.toBe('PAID');
    const pid = (e.chain.jettons[0] as IncomingPayment).txHash;
    try { e.svc.attach(d.id, saleId, pid); } catch { /* nothing to attach */ }
    expect(e.svc.status(d.id).state).not.toBe('PAID'); // attaching a fake-token payment yields FAKE, never PAID
    e.svc.void(d.id, saleId);
    saleId = e.svc.arm(d.id, '12.00', 'USDT').saleId;

    // a genuine unmatched payment attaches once; a second attach to another sale is refused
    e.chain.jettons.length = 0;
    e.chain.jettons.push(jetton(GOOD, null, T0 + 6));
    await e.svc.tick();
    const st = e.svc.status(d.id);
    expect(st.state).toBe('UNMATCHED');
    e.svc.attach(d.id, saleId, st.unmatched.paymentId);
    expect(e.svc.status(d.id).state).toBe('PAID');
    const second = e.svc.arm(d.id, '12.00', 'USDT').saleId;
    expect(() => e.svc.attach(d.id, second, st.unmatched.paymentId)).toThrow(/no such unmatched/);
    expect(e.svc.status(d.id).state).toBe('WAITING');
  });

  it("a ref belonging to another shop's sale never counts for this shop", async () => {
    const e = env();
    const a = pairedDevice(e, 'dev-A', 1);
    const b = pairedDevice(e, 'dev-B', 2);
    (e.svc as any).d.db.prepare('UPDATE shops SET address=? WHERE id=?').run(OTHER.toRawString(), b.shop);
    const saleB = e.svc.arm(b.id, '12.00', 'USDT').saleId;
    e.svc.arm(a.id, '12.00', 'USDT');
    // paid to shop A's address with shop B's sale ref
    e.chain.jettons.push({ ...jetton(GOOD, `st:${saleB}`, T0 + 5), to: normalizeAddress(SELLER.toRawString()) } as IncomingPayment);
    await e.svc.tick();
    expect(e.svc.status(a.id).state).toBe('UNMATCHED');
    expect(e.svc.status(b.id).state).toBe('WAITING');
  });

  it('a double tap on receipt sends one receipt', async () => {
    const e = env();
    const d = pairedDevice(e);
    const { saleId } = e.svc.arm(d.id, '12.00', 'USDT');
    const ref = e.svc.mintRef(saleId, 700);
    e.chain.jettons.push(jetton(GOOD, `st:${ref}`, T0 + 5));
    await e.svc.tick();
    expect(e.svc.status(d.id).state).toBe('PAID');
    const before = e.tg.sent.length;
    await Promise.all([e.svc.receipt(d.id, saleId), e.svc.receipt(d.id, saleId)]);
    expect(e.tg.sent.length - before).toBe(1);
  });
});

describe('HTTP hardening', () => {
  it('sends no-referrer and nosniff, and static serving cannot escape the pay dir', async () => {
    const e = env();
    const dir = mkdtempSync(join(tmpdir(), 'pay-'));
    writeFileSync(join(dir, 'index.html'), '<html></html>');
    writeFileSync(join(dir, '..', 'secret-outside.txt'), 'top secret');
    const api = createApi({ svc: e.svc, bot: e.bot, cfg: cfg({ payDir: dir }) });
    const get = (path: string) => api({ method: 'GET', path, query: new URLSearchParams(), headers: {}, body: Buffer.alloc(0) });
    const ok = await get('/pay/');
    expect(ok.status).toBe(200);
    expect(ok.headers['referrer-policy']).toBe('no-referrer');
    expect(ok.headers['x-content-type-options']).toBe('nosniff');
    for (const p of ['/pay/../secret-outside.txt', '/pay/..%2fsecret-outside.txt', '/pay/%2e%2e/secret-outside.txt', '/pay/..\\secret-outside.txt', '/pay//etc/passwd', '/pay/index.html%00.png']) {
      const r = await get(p);
      expect(r.status).toBe(404);
      expect(String(r.body)).not.toContain('top secret');
    }
  });

  it('error responses do not leak internals', async () => {
    const e = env();
    const d = pairedDevice(e);
    (e.svc as any).arm = () => { throw new Error('SQLITE_ERROR /opt/shoptill/shoptill.db secret'); };
    const r = await e.call('POST', '/api/till/arm', { deviceId: d.id, amount: '1', asset: 'USDT' }, { 'x-device-secret': d.secret });
    expect(r.status).toBe(500);
    expect(r.json).toEqual({ error: 'internal error' });
  });

  it('the rate limiter forgets old hits', () => {
    const rl = new RateLimiter(2, 1000);
    expect([rl.hit('a', 0), rl.hit('a', 1), rl.hit('a', 2)]).toEqual([true, true, false]);
    expect(rl.hit('a', 2000)).toBe(true);
  });
});
