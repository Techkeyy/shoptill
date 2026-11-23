import { Address } from '@ton/core';
import { normalizeAddress } from '@shoptill/core';
import type { IncomingPayment } from '@shoptill/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from './api.ts';
import { signInitData, signToken, validateInitData, verifyToken } from './auth.ts';
import { Bot } from './bot.ts';
import { loadConfig, type Config } from './config.ts';
import { openDb } from './db.ts';
import { HttpError, Till, type Chain } from './service.ts';
import type { Markup, Tg, Update } from './telegram.ts';

const BOT_TOKEN = '123456:TEST-TOKEN';
const addr = (n: number) => new Address(0, Buffer.alloc(32, n));
const SELLER = addr(1);
const CUSTOMER = addr(2);
const GOOD = addr(3);
const FAKE = addr(4);
const T0 = 1_800_000_000; // seconds

class FakeChain implements Chain {
  native: IncomingPayment[] = [];
  jettons: IncomingPayment[] = [];
  async getIncomingTransactions(_a: string, since: number) { return this.native.filter((p) => p.utime >= since); }
  async getJettonTransfersTo(_a: string, since: number) { return this.jettons.filter((p) => p.utime >= since); }
  rawCalls: { path: string; params: Record<string, string> }[] = [];
  jettonWallets: any[] = [{ address: '0:' + 'ab'.repeat(32), balance: '5000000' }];
  accountBalance = '300000000';
  async raw(path: string, params: Record<string, string>) {
    this.rawCalls.push({ path, params });
    if (path === '/jetton/wallets') return { jetton_wallets: this.jettonWallets };
    if (path === '/account') return { balance: this.accountBalance };
    return {};
  }
}

class FakeTg implements Tg {
  sent: { chat: number; text: string; markup?: Markup; id: number }[] = [];
  edits: { chat: number; id: number; text: string; markup?: Markup }[] = [];
  photos: { chat: number; bytes: number; caption: string }[] = [];
  private n = 100;
  async me() { return { username: 'ShopTillBot' }; }
  async send(chat: number, text: string, markup?: Markup) { const id = ++this.n; this.sent.push({ chat, text, markup, id }); return id; }
  async edit(chat: number, id: number, text: string, markup?: Markup) { this.edits.push({ chat, id, text, markup }); }
  async photo(chat: number, png: Uint8Array, caption: string) { this.photos.push({ chat, bytes: png.length, caption }); }
  async answerCb() {}
  async getUpdates(): Promise<Update[]> { return []; }
}

function cfg(over: Partial<Config> = {}): Config {
  return {
    botToken: BOT_TOKEN, groqKey: '', tonKey: '', publicUrl: 'https://shoptill.test', port: 0, network: 'testnet',
    dbPath: ':memory:', payDir: '/nonexistent',
    usdt: { master: GOOD.toRawString(), decimals: 6 }, jettonMasters: [GOOD.toRawString()], jettonDecimals: {},
    ...over,
  };
}

let seq = 0;
function pay(o: Partial<IncomingPayment> & { comment: string | null }): IncomingPayment {
  seq++;
  return {
    txHash: `tx${seq}`, lt: String(1000 + seq), utime: T0 + 5, success: true,
    from: normalizeAddress(CUSTOMER.toRawString()), asset: { kind: 'native' }, amountRaw: '12000000000', decimals: 9, ...o,
  };
}
const usdt = (amount: string, comment: string | null, master = GOOD, extra: Partial<IncomingPayment> = {}) =>
  pay({ comment, asset: { kind: 'jetton', master: normalizeAddress(master.toRawString()) }, amountRaw: amount, decimals: 6, ...extra });

interface Env { svc: Till; chain: FakeChain; tg: FakeTg; clock: { ms: number }; shopId: number; device: string; bot: Bot }

async function setup(c: Config = cfg()): Promise<Env> {
  const chain = new FakeChain();
  const tg = new FakeTg();
  const clock = { ms: T0 * 1000 };
  const svc = new Till({ db: openDb(':memory:'), cfg: c, ton: chain, tg, now: () => clock.ms, log: () => {} });
  const bot = new Bot(svc, tg, c, () => {});
  await bot.init();
  const device = 'dev-1';
  const { code } = svc.pair(device);
  const shopId = svc.linkCode(555, code!)!;
  svc.setShopName(shopId, 'Barber Bob');
  svc.setShopAddress(shopId, SELLER.toRawString());
  return { svc, chain, tg, clock, shopId, device, bot };
}

describe('pairing', () => {
  it('returns a code until linked, then paired', async () => {
    const chain = new FakeChain();
    const svc = new Till({ db: openDb(':memory:'), cfg: cfg(), ton: chain, tg: new FakeTg(), now: () => T0 * 1000, log: () => {} });
    const a = svc.pair('d');
    expect(a.paired).toBe(false);
    expect(a.code).toMatch(/^TILL-\d{6}$/);
    expect(svc.pair('d', a.deviceSecret).code).toBe(a.code);
    const shop = svc.linkCode(1, a.code!)!;
    expect(svc.linkCode(2, a.code!)).toBeNull(); // single use
    svc.setShopName(shop, 'Cafe');
    expect(svc.pair('d', a.deviceSecret).paired).toBe(false); // wallet not yet connected
    svc.setShopAddress(shop, SELLER.toRawString());
    expect(svc.pair('d', a.deviceSecret)).toEqual({ paired: true, shopName: 'Cafe' });
    expect(() => svc.pair('d')).toThrow(/bad device secret/); // a paired device needs its secret
  });
  it('rejects a bad address', async () => {
    const { svc, shopId } = await setup();
    expect(() => svc.setShopAddress(shopId, 'not-an-address')).toThrow(HttpError);
  });
});

describe('payment routing and states', () => {
  let e: Env;
  beforeEach(async () => { e = await setup(); });

  const arm = (amount = '12.00', asset = 'GRAM') => e.svc.arm(e.device, amount, asset).saleId;
  const statusState = () => e.svc.status(e.device).state;

  it('WAITING until a real payment arrives (a screenshot cannot flip it)', async () => {
    arm();
    await e.svc.tick();
    expect(statusState()).toBe('WAITING');
  });

  it('ageSec counts from the payment, not from sale creation', async () => {
    const id = arm();
    const r = e.svc.mintRef(id, 777);
    e.chain.native.push(pay({ comment: `st:${r}`, utime: T0 + 5 }));
    await e.svc.tick();
    e.clock.ms += 100_000;
    const st = e.svc.status(e.device);
    expect(st.state).toBe('PAID');
    expect(st.sale.paidAt).toBe(T0 + 5);
    expect(st.sale.ageSec).toBe(95);
  });

  it('two refs, one sale: either ref pays it, the other mini app sees paid', async () => {
    const id = arm();
    const r1 = e.svc.mintRef(id, 777);
    const r2 = e.svc.mintRef(id, 888);
    e.svc.setRefMessage(r1, 11);
    e.svc.setRefMessage(r2, 22);
    e.chain.native.push(pay({ comment: `st:${r2}` }));
    await e.svc.tick();
    expect(statusState()).toBe('PAID');
    expect(e.svc.payInfo(r1)!.state).toBe('PAID');
    expect(e.tg.edits.map((x) => x.id).sort()).toEqual([11, 22]);
    expect(e.tg.edits.find((x) => x.id === 22)!.text).toContain('Paid ✓');
    expect(e.tg.edits.find((x) => x.id === 11)!.text).toContain('Already paid');
  });

  it('no ref -> UNMATCHED, attach makes it PAID', async () => {
    const id = arm();
    e.chain.native.push(pay({ comment: null }));
    await e.svc.tick();
    const st = e.svc.status(e.device);
    expect(st.state).toBe('UNMATCHED');
    expect(st.unmatched.amount).toBe('12.00');
    e.svc.attach(e.device, id, st.unmatched.paymentId);
    expect(statusState()).toBe('PAID');
  });

  it('unknown ref -> UNMATCHED', async () => {
    arm();
    e.chain.native.push(pay({ comment: 'st:zzzzzzzz' }));
    await e.svc.tick();
    expect(statusState()).toBe('UNMATCHED');
  });

  it('non-allowlisted spam without ref is ignored', async () => {
    arm();
    e.chain.jettons.push(usdt('5000000', null, FAKE));
    await e.svc.tick();
    expect(statusState()).toBe('WAITING');
  });

  it('FAKE token with the right ref never pays', async () => {
    const id = arm('12.00', 'USDT');
    const ref = e.svc.mintRef(id, 777);
    e.chain.jettons.push(usdt('12000000', `st:${ref}`, FAKE));
    await e.svc.tick();
    expect(statusState()).toBe('FAKE');
    expect(e.svc.sale(id).paid_raw).toBe('0');
  });

  it('USDT jetton PAID with forward comment', async () => {
    const id = arm('12.00', 'USDT');
    const ref = e.svc.mintRef(id, 777);
    e.chain.jettons.push(usdt('12000000', `st:${ref}`));
    await e.svc.tick();
    const st = e.svc.status(e.device);
    expect(st.state).toBe('PAID');
    expect(st.sale.receivedTotal).toBe('12.00');
  });

  it('SHORT then top-up becomes PAID', async () => {
    const id = arm();
    const ref = e.svc.mintRef(id, 777);
    e.chain.native.push(pay({ comment: `st:${ref}`, amountRaw: '9000000000' }));
    await e.svc.tick();
    const st = e.svc.status(e.device);
    expect(st.state).toBe('SHORT');
    expect(st.sale.missing).toBe('3.00');
    e.chain.native.push(pay({ comment: `st:${ref}`, amountRaw: '3000000000' }));
    await e.svc.tick();
    expect(statusState()).toBe('PAID');
  });

  it('EXTRA reports the surplus', async () => {
    const id = arm();
    const ref = e.svc.mintRef(id, 777);
    e.chain.native.push(pay({ comment: `st:${ref}`, amountRaw: '14000000000' }));
    await e.svc.tick();
    const st = e.svc.status(e.device);
    expect(st.state).toBe('EXTRA');
    expect(st.sale.extra).toBe('2.00');
  });

  it('DUPLICATE on a second full payment', async () => {
    const id = arm();
    const ref = e.svc.mintRef(id, 777);
    e.chain.native.push(pay({ comment: `st:${ref}` }));
    await e.svc.tick();
    e.chain.native.push(pay({ comment: `st:${ref}`, lt: '99999' }));
    await e.svc.tick();
    expect(statusState()).toBe('DUPLICATE');
  });

  it('LATE when the payment lands after the sale was voided', async () => {
    const id = arm();
    const ref = e.svc.mintRef(id, 777);
    e.clock.ms += 3000;
    e.svc.void(e.device, id);
    expect(statusState()).toBe('VOID');
    e.clock.ms += 11_000;
    e.chain.native.push(pay({ comment: `st:${ref}`, utime: T0 + 10 }));
    await e.svc.tick();
    expect(e.svc.sale(id).state).toBe('LATE');
    expect(e.tg.sent.some((m) => m.chat === 555 && m.text.includes('LATE'))).toBe(true);
  });

  it('failed or bounced transactions are ignored', async () => {
    const id = arm();
    const ref = e.svc.mintRef(id, 777);
    e.chain.native.push(pay({ comment: `st:${ref}`, success: false }));
    await e.svc.tick();
    expect(statusState()).toBe('WAITING');
  });

  it('dedupes by tx hash', async () => {
    const id = arm();
    const ref = e.svc.mintRef(id, 777);
    const p = pay({ comment: `st:${ref}`, amountRaw: '6000000000' });
    e.chain.native.push(p);
    await e.svc.tick();
    await e.svc.tick();
    expect(e.svc.sale(id).paid_raw).toBe('6000000000');
  });

  it('expires after 15 minutes', async () => {
    arm();
    e.clock.ms += 16 * 60 * 1000;
    await e.svc.tick();
    expect(statusState()).toBe('VOID');
  });

  it('arming again voids the previous open sale', async () => {
    const a = arm();
    arm('5.00');
    expect(e.svc.sale(a).state).toBe('VOID');
  });

  it('USDT arm is refused when no jetton is configured (GRAM only)', async () => {
    const g = await setup(cfg({ usdt: undefined, jettonMasters: [] }));
    expect(() => g.svc.arm(g.device, '1.00', 'USDT')).toThrow(/GRAM only/);
    expect(g.svc.arm(g.device, '1.00', 'GRAM').saleId).toBeTruthy();
  });

  it('persists state transitions with timestamps', async () => {
    const id = arm();
    const ref = e.svc.mintRef(id, 777);
    e.chain.native.push(pay({ comment: `st:${ref}` }));
    await e.svc.tick();
    const rows = (e.svc as any).d.db.prepare('SELECT state, at FROM sale_events WHERE sale_id=? ORDER BY rowid').all(id);
    expect(rows.map((r: any) => r.state)).toEqual(['WAITING', 'PAID']);
    expect(rows[1].at).toBeGreaterThan(0);
  });

  it('today counts PAID and EXTRA only', async () => {
    const id = arm();
    const ref = e.svc.mintRef(id, 777);
    e.chain.native.push(pay({ comment: `st:${ref}` }));
    await e.svc.tick();
    expect(e.svc.today(e.device)).toEqual({ count: 1, total: '12.00', asset: 'GRAM' });
  });
});

describe('seller DM', () => {
  it('DMs the seller when the glasses are not polling', async () => {
    const e = await setup();
    const id = e.svc.arm(e.device, '12.00', 'GRAM').saleId;
    const ref = e.svc.mintRef(id, 777);
    e.chain.native.push(pay({ comment: `st:${ref}` }));
    await e.svc.tick();
    expect(e.tg.sent.filter((m) => m.chat === 555).map((m) => m.text)).toContain('Paid 12.00 GRAM · Barber Bob');
  });
  it('stays quiet when the glasses polled within 10 s', async () => {
    const e = await setup();
    const id = e.svc.arm(e.device, '12.00', 'GRAM').saleId;
    const ref = e.svc.mintRef(id, 777);
    e.svc.status(e.device);
    e.clock.ms += 2000;
    e.chain.native.push(pay({ comment: `st:${ref}` }));
    await e.svc.tick();
    expect(e.tg.sent.filter((m) => m.chat === 555 && m.text.startsWith('Paid'))).toHaveLength(0);
  });
});

describe('receipt', () => {
  it('is refused unless PAID/EXTRA, then sent once to the customer', async () => {
    const e = await setup();
    const id = e.svc.arm(e.device, '12.00', 'GRAM').saleId;
    const ref = e.svc.mintRef(id, 777);
    await expect(e.svc.receipt(e.device, id)).rejects.toMatchObject({ status: 409 });
    e.chain.native.push(pay({ comment: `st:${ref}`, txHash: 'a'.repeat(64) }));
    await e.svc.tick();
    expect(await e.svc.receipt(e.device, id)).toEqual({ sent: true });
    const msg = e.tg.sent.filter((m) => m.chat === 777).pop()!;
    expect(msg.text).toContain('12.00 GRAM paid to Barber Bob');
    expect(msg.text).toContain(`https://testnet.tonviewer.com/transaction/${'a'.repeat(64)}`);
    expect(await e.svc.receipt(e.device, id)).toEqual({ sent: false });
  });
  it('is refused for SHORT', async () => {
    const e = await setup();
    const id = e.svc.arm(e.device, '12.00', 'GRAM').saleId;
    const ref = e.svc.mintRef(id, 777);
    e.chain.native.push(pay({ comment: `st:${ref}`, amountRaw: '1000000000' }));
    await e.svc.tick();
    await expect(e.svc.receipt(e.device, id)).rejects.toMatchObject({ status: 409 });
  });
});

describe('initData and tokens', () => {
  const user = JSON.stringify({ id: 42, first_name: 'A' });
  const fresh = () => String(Math.floor(Date.now() / 1000));
  it('accepts a correctly signed initData', () => {
    const d = signInitData({ auth_date: fresh(), user, query_id: 'q' }, BOT_TOKEN);
    expect(validateInitData(d, BOT_TOKEN)?.user.id).toBe(42);
  });
  it('rejects tampering, wrong bot, stale and missing hash', () => {
    const d = signInitData({ auth_date: fresh(), user }, BOT_TOKEN);
    expect(validateInitData(d.replace('42', '43'), BOT_TOKEN)).toBeNull();
    expect(validateInitData(d, 'other:token')).toBeNull();
    const old = signInitData({ auth_date: String(Math.floor(Date.now() / 1000) - 200000), user }, BOT_TOKEN);
    expect(validateInitData(old, BOT_TOKEN)).toBeNull();
    expect(validateInitData('auth_date=1&user=%7B%7D', BOT_TOKEN)).toBeNull();
    expect(validateInitData('', BOT_TOKEN)).toBeNull();
  });
  it('tokens verify, expire and cannot be forged', () => {
    const t = signToken({ k: 'pay', chat: 1, ref: 'abc', exp: 2000 }, BOT_TOKEN);
    expect(verifyToken(t, BOT_TOKEN, 1000)?.ref).toBe('abc');
    expect(verifyToken(t, BOT_TOKEN, 3000)).toBeNull();
    expect(verifyToken(t, 'x:y', 1000)).toBeNull();
    expect(verifyToken(t.slice(0, -2) + 'aa', BOT_TOKEN, 1000)).toBeNull();
  });
});

describe('full flow (fake toncenter + fake telegram, through the HTTP handler)', () => {
  it('pair -> bot onboarding -> arm -> customer -> payment -> PAID -> receipt', async () => {
    const chain = new FakeChain();
    const tg = new FakeTg();
    const c = cfg();
    const clock = { ms: Date.now() };
    const svc = new Till({ db: openDb(':memory:'), cfg: c, ton: chain, tg, now: () => clock.ms, log: () => {} });
    const bot = new Bot(svc, tg, c, () => {});
    await bot.init();
    const api = createApi({ svc, bot, cfg: c });
    let secret = '';
    const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
      const u = new URL(path, 'http://x');
      const r = await api({ method, path: u.pathname, query: u.searchParams, headers: { ...(secret ? { 'x-device-secret': secret } : {}), ...headers }, body: body ? Buffer.from(JSON.stringify(body)) : Buffer.alloc(0) });
      return { status: r.status, json: r.body && String(r.headers['content-type']).includes('json') ? JSON.parse(String(r.body)) : null };
    };
    const msg = (chat: number, text: string): Update => ({ update_id: 1, message: { message_id: 1, chat: { id: chat, type: 'private' }, text } });

    // glasses pair
    const pair = (await call('POST', '/api/device/pair', { deviceId: 'g1' })).json;
    expect(pair.code).toMatch(/^TILL-/);
    secret = pair.deviceSecret;
    expect(secret).toBeTruthy();
    // seller onboards via the bot
    await bot.handle(msg(900, pair.code));
    await bot.handle(msg(900, 'Coffee Cart'));
    const webBtn = tg.sent.find((m) => m.markup?.inline_keyboard[0]?.[0]?.web_app)!;
    const setupUrl = new URL(webBtn.markup!.inline_keyboard[0]![0]!.web_app!.url);
    expect(setupUrl.searchParams.get('mode')).toBe('setup');
    const setupToken = setupUrl.searchParams.get('t')!;
    const init = (id: number) => signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id }) }, BOT_TOKEN);
    expect((await call('POST', '/api/shop/address', { t: setupToken, address: SELLER.toRawString() })).status).toBe(401); // no initData
    expect((await call('POST', '/api/shop/address', { t: setupToken, address: SELLER.toRawString() }, { 'x-tg-init-data': init(1) })).status).toBe(401); // other user
    expect((await call('POST', '/api/shop/address', { t: setupToken, address: SELLER.toRawString() }, { 'x-tg-init-data': init(900) })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 200));
    expect(tg.photos[0]!.caption).toBe('Print this and stick it on your counter');
    expect((await call('POST', '/api/device/pair', { deviceId: 'g1' })).json).toEqual({ paired: true, shopName: 'Coffee Cart' });

    // nothing armed: customer sees Refresh
    await bot.handle(msg(700, '/start shop_1'));
    expect(tg.sent.at(-1)!.text).toContain("hasn't set a price");
    expect(tg.sent.at(-1)!.markup!.inline_keyboard[0]![0]!.callback_data).toBe('refresh:1');

    // seller arms
    const { saleId } = (await call('POST', '/api/till/arm', { deviceId: 'g1', amount: '12.00', asset: 'USDT' })).json;
    expect((await call('GET', '/api/till/status?deviceId=g1')).json.state).toBe('WAITING');

    // customer taps Refresh -> Pay button with ref
    await bot.handle({ update_id: 2, callback_query: { id: 'cb', from: { id: 700 }, data: 'refresh:1', message: { chat: { id: 700 }, message_id: 55 } } });
    const payUrl = new URL(tg.edits.find((x) => x.id === 55)!.markup!.inline_keyboard[0]![0]!.web_app!.url);
    const ref = payUrl.searchParams.get('ref')!;
    const t = payUrl.searchParams.get('t')!;
    expect(payUrl.searchParams.get('sale')).toBe(saleId);

    // mini app info (needs initData for the same user)
    expect((await call('GET', `/api/pay/info?ref=${ref}&t=${encodeURIComponent(t)}`)).status).toBe(401);
    const info = await call('GET', `/api/pay/info?ref=${ref}&t=${encodeURIComponent(t)}`, undefined, { 'x-tg-init-data': init(700) });
    expect(info.status).toBe(200);
    expect(info.json).toMatchObject({ shop: 'Coffee Cart', amount: '12.00', asset: 'USDT', state: 'WAITING', network: 'testnet' });

    // customer pays on chain
    chain.jettons.push(usdt('12000000', `st:${ref}`, GOOD, { utime: Math.floor(clock.ms / 1000) + 3 }));
    await svc.tick();
    const st = (await call('GET', '/api/till/status?deviceId=g1')).json;
    expect(st.state).toBe('PAID');
    expect(st.sale.amount).toBe('12.00');
    expect((await call('GET', `/api/pay/info?ref=${ref}&t=${encodeURIComponent(t)}`, undefined, { 'x-tg-init-data': init(700) })).json.state).toBe('PAID');
    expect(tg.edits.some((x) => x.chat === 700 && x.text.includes('Paid ✓'))).toBe(true);

    // receipt
    expect((await call('POST', '/api/till/receipt', { deviceId: 'g1', saleId })).status).toBe(200);
    expect(tg.sent.at(-1)!.chat).toBe(700);
    expect(tg.sent.at(-1)!.text).toContain('tonviewer');
    expect((await call('GET', '/api/today?deviceId=g1')).json).toEqual({ count: 1, total: '12.00', asset: 'USDT' });
    expect((await call('OPTIONS', '/api/till/arm')).status).toBe(204);
    expect((await call('GET', '/healthz')).json).toEqual({ ok: true });
  });
});

describe('config DB_PATH', () => {
  it('empty DB_PATH resolves to a real file path, not an empty string', () => {
    const c = loadConfig({ DB_PATH: '' });
    expect(c.dbPath).not.toBe('');
    expect(c.dbPath.endsWith('shoptill.db')).toBe(true);
    expect(loadConfig({}).dbPath).toBe(c.dbPath);
    expect(loadConfig({ DB_PATH: '/x/y.db' }).dbPath).toBe('/x/y.db');
  });
});

describe('pay balance + jetton-wallet endpoints', () => {
  it('require auth and return balance/exists', async () => {
    const e = await setup();
    const c = cfg();
    const api = createApi({ svc: e.svc, bot: e.bot, cfg: c });
    const call = async (path: string, headers: Record<string, string> = {}) => {
      const u = new URL(path, 'http://x');
      const r = await api({ method: 'GET', path: u.pathname, query: u.searchParams, headers, body: Buffer.alloc(0) });
      return { status: r.status, json: JSON.parse(String(r.body)) };
    };
    const { saleId } = e.svc.arm(e.device, '5.00', 'USDT');
    const ref = e.svc.mintRef(saleId, 700);
    const t = signToken({ k: 'pay', chat: 700, ref, exp: Math.floor(Date.now() / 1000) + 600 }, BOT_TOKEN);
    const init = signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 700 }) }, BOT_TOKEN);
    const owner = encodeURIComponent(CUSTOMER.toRawString());
    const bal = `/api/pay/balance?ref=${ref}&t=${encodeURIComponent(t)}&owner=${owner}`;
    const jw = `/api/pay/jetton-wallet?ref=${ref}&t=${encodeURIComponent(t)}&owner=${owner}`;
    expect((await call(bal)).status).toBe(401);
    expect((await call(jw)).status).toBe(401);
    const b = await call(bal, { 'x-tg-init-data': init });
    expect(b.status).toBe(200);
    expect(b.json).toEqual({ balance: '300000000' });
    const j = await call(jw, { 'x-tg-init-data': init });
    expect(j.json).toMatchObject({ balance: '5000000', exists: true });
    e.chain.jettonWallets = [];
    expect((await call(jw, { 'x-tg-init-data': init })).json).toMatchObject({ balance: '0', exists: false });
  });
});
