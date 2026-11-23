// Live edge-state harness: runs the REAL server service against REAL TON testnet, in-process.
// Dev harness only (seeds a shop straight into a local SQLite file; not a prod path).
//   npx tsx server/scripts/live-states.ts
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Address, beginCell, internal, SendMode, toNano } from '@ton/core';
import { TonCenter } from '@shoptill/core';
import { client, friendly, loadWallet, readSecretJson, retry, ROOT, sleep } from '../../packages/core/scripts/common.ts';
import { loadConfig, readJettonConfig } from '../src/config.ts';
import { openDb, one, run } from '../src/db.ts';
import { Till, tonviewerLink, type Chain } from '../src/service.ts';
import type { Tg, Markup } from '../src/telegram.ts';
import { readFileSync } from 'node:fs';

const DB = resolve(ROOT, 'evidence/live-states.db');
const OUT = resolve(ROOT, 'evidence/live-states.md');
const TIMEOUT_MS = 120_000;
const MIN_GRAM = 0.9;

const jt = readSecretJson('testnet-jettons.json');
const jcfg = JSON.parse(readFileSync(resolve(ROOT, 'packages/core/testnet.config.json'), 'utf8'));
const GOOD: string = jcfg.allowlistedJettonMaster;
const FAKE: string = jt.fake.master;

const merchant = await loadWallet('merchant');
const cust = await loadWallet('customer');
const c = client();
const opened = c.open(cust.contract);

// ---- preflight ----
const balNano = await retry(() => c.getBalance(cust.address));
const gram = Number(balNano) / 1e9;
async function jettonWallet(master: string): Promise<Address> {
  const r = await retry(() => c.runMethod(Address.parse(master), 'get_wallet_address', [{ type: 'slice', cell: beginCell().storeAddress(cust.address).endCell() }]));
  return r.stack.readAddress();
}
async function jettonBalance(master: string): Promise<bigint> {
  try {
    const jw = await jettonWallet(master);
    const r = await retry(() => c.runMethod(jw, 'get_wallet_data'));
    return r.stack.readBigNumber();
  } catch { return 0n; }
}
const goodBal = await jettonBalance(GOOD);
const fakeBal = await jettonBalance(FAKE);
console.log(`customer ${friendly(cust.address)}  GRAM ${gram.toFixed(3)}  USDT ${Number(goodBal) / 1e6}  fakeUSDT ${Number(fakeBal) / 1e6}`);
if (gram < MIN_GRAM) {
  console.log(`STOP: customer GRAM ${gram.toFixed(3)} < ${MIN_GRAM}. Fund this address (testnet faucet @testgiver_ton_bot) and re-run:\n  ${friendly(cust.address)}`);
  process.exit(2);
}
if (goodBal < 8_300_000n || fakeBal < 1_000_000n) {
  console.log(`STOP: need >= 8.30 test USDT and >= 1.00 fake USDT on the customer wallet (have ${Number(goodBal) / 1e6} / ${Number(fakeBal) / 1e6}). Mint with the jettons script.`);
  process.exit(3);
}

// ---- real service on a fresh db ----
for (const f of [DB, DB + '-wal', DB + '-shm']) if (existsSync(f)) rmSync(f);
mkdirSync(resolve(ROOT, 'evidence'), { recursive: true });
const base = loadConfig({ NETWORK: 'testnet', DB_PATH: DB, TONCENTER_API_KEY: process.env.TONCENTER_API_KEY });
const jc = readJettonConfig(jcfg);
const cfg = { ...base, network: 'testnet' as const, dbPath: DB, usdt: jc.usdt, jettonMasters: jc.masters, jettonDecimals: { ...jc.decimals, [FAKE]: 6 } };
const tc = new TonCenter({ apiKey: cfg.tonKey || undefined, jettonDecimals: cfg.jettonDecimals });
const chain: Chain = {
  getIncomingTransactions: (a, s) => tc.getIncomingTransactions(a, s),
  getJettonTransfersTo: (a, s) => tc.getJettonTransfersTo(a, s),
  raw: (p, q) => tc.get(p, q),
};
class RecTg implements Tg {
  log: string[] = [];
  private n = 0;
  async me() { return { username: 'harness' }; }
  async send(chat: number, text: string, _m?: Markup) { this.log.push(`send ${chat}: ${text}`); return ++this.n; }
  async edit(chat: number, id: number, text: string) { this.log.push(`edit ${chat}/${id}: ${text}`); }
  async photo() {}
  async answerCb() {}
  async getUpdates() { return []; }
}
const tg = new RecTg();
const db = openDb(DB);
const svc = new Till({ db, cfg, ton: chain, tg, log: () => {} });

// seed shop + paired device (dev harness, direct DB)
const DEVICE = 'harness-device';
svc.pair(DEVICE);
const shopId = Number(run(db, "INSERT INTO shops(seller_chat, name, address, stage, created_at) VALUES(1,'Harness Shop',?, 'ready', ?)", merchant.address.toRawString(), Date.now()).lastInsertRowid);
run(db, 'UPDATE devices SET shop_id=? WHERE device_id=?', shopId, DEVICE);

// ---- sending (real testnet, from the customer wallet) ----
const commentCell = (t: string) => beginCell().storeUint(0, 32).storeStringTail(t).endCell();
async function sendMsg(to: Address, value: bigint, body: any, bounce: boolean) {
  const seqno = await retry(() => opened.getSeqno());
  await retry(() => opened.sendTransfer({
    seqno, secretKey: cust.kp.secretKey, sendMode: SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS,
    messages: [internal({ to, value, bounce, body })],
  }));
  // wait for this seqno to be consumed before anything else is sent from this wallet
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    if ((await retry(() => opened.getSeqno())) > seqno) return;
  }
  throw new Error('seqno did not advance in 120 s');
}
const sendGram = (ref: string, nano: bigint) => sendMsg(merchant.address, nano, commentCell(`st:${ref}`), false);
async function sendJetton(master: string, amountRaw: bigint, ref: string | null) {
  const jw = await jettonWallet(master);
  const b = beginCell().storeUint(0x0f8a7ea5, 32).storeUint(0, 64).storeCoins(amountRaw)
    .storeAddress(merchant.address).storeAddress(cust.address).storeBit(0).storeCoins(toNano('0.01'));
  if (ref) b.storeBit(1).storeRef(commentCell(`st:${ref}`)); else b.storeBit(0);
  await sendMsg(jw, toNano('0.1'), b.endCell(), true);
}

// ---- helpers ----
let chatSeq = 1000;
const newRef = (saleId: string) => { const r = svc.mintRef(saleId, ++chatSeq); svc.setRefMessage(r, chatSeq); return r; };
const stateOf = (id: string): string => svc.sale(id).state;
async function waitFor(id: string, want: string[], from: number): Promise<{ state: string; ms: number }> {
  for (;;) {
    await svc.tick();
    const st = stateOf(id);
    if (want.includes(st)) return { state: st, ms: Date.now() - from };
    if (Date.now() - from > TIMEOUT_MS) return { state: st + ' (timeout)', ms: Date.now() - from };
    await sleep(1500);
  }
}
const hashes = (id: string) => (db.prepare('SELECT tx_hash FROM payments WHERE sale_id=? OR ref IN (SELECT ref FROM refs WHERE sale_id=?)').all(id, id) as any[]).map((r) => r.tx_hash as string);

interface Row { n: number; name: string; expected: string; observed: string; ok: boolean; ms: number | null; txs: string[]; note?: string }
const rows: Row[] = [];
async function runCase(n: number, name: string, expected: string, fn: () => Promise<{ observed: string; ms: number; saleId: string; note?: string }>) {
  console.log(`\n--- case ${n}: ${name} (expect ${expected})`);
  try {
    const r = await fn();
    const row: Row = { n, name, expected, observed: r.observed, ok: r.observed === expected, ms: r.ms, txs: hashes(r.saleId), note: r.note };
    rows.push(row);
    console.log(`    observed ${row.observed} in ${row.ms} ms ${row.ok ? 'OK' : 'MISMATCH'}`);
  } catch (e) {
    rows.push({ n, name, expected, observed: 'ERROR: ' + (e as Error).message.slice(0, 120), ok: false, ms: null, txs: [] });
    console.log('    error: ' + (e as Error).message);
  }
}
const arm = (amt: string, asset: 'USDT' | 'GRAM') => svc.arm(DEVICE, amt, asset).saleId;

await runCase(1, 'PAID: USDT exact 1.00', 'PAID', async () => {
  const id = arm('1.00', 'USDT'); const ref = newRef(id);
  const t = Date.now(); await sendJetton(GOOD, 1_000_000n, ref);
  const r = await waitFor(id, ['PAID'], t); return { observed: r.state, ms: r.ms, saleId: id };
});
await runCase(2, 'SHORT then top-up: 0.40 + 0.60 of 1.00', 'PAID', async () => {
  const id = arm('1.00', 'USDT'); const r1 = newRef(id);
  const t = Date.now(); await sendJetton(GOOD, 400_000n, r1);
  const s = await waitFor(id, ['SHORT'], t);
  if (s.state !== 'SHORT') return { observed: 'step1 ' + s.state, ms: s.ms, saleId: id };
  const r2 = newRef(id); const t2 = Date.now(); await sendJetton(GOOD, 600_000n, r2);
  const p = await waitFor(id, ['PAID'], t2); return { observed: p.state, ms: p.ms, saleId: id, note: 'SHORT seen after ' + s.ms + ' ms' };
});
await runCase(3, 'EXTRA: 1.30 for 1.00', 'EXTRA', async () => {
  const id = arm('1.00', 'USDT'); const ref = newRef(id);
  const t = Date.now(); await sendJetton(GOOD, 1_300_000n, ref);
  const r = await waitFor(id, ['EXTRA', 'PAID'], t); return { observed: r.state, ms: r.ms, saleId: id };
});
await runCase(4, 'DUPLICATE: two full payments, two refs', 'DUPLICATE', async () => {
  const id = arm('1.00', 'USDT'); const r1 = newRef(id); const r2 = newRef(id);
  const t = Date.now();
  await sendJetton(GOOD, 1_000_000n, r1);
  await sendJetton(GOOD, 1_000_000n, r2);
  const r = await waitFor(id, ['DUPLICATE'], t); return { observed: r.state, ms: r.ms, saleId: id };
});
await runCase(5, 'FAKE: look-alike USDT with valid ref', 'FAKE', async () => {
  const id = arm('1.00', 'USDT'); const ref = newRef(id);
  const t = Date.now(); await sendJetton(FAKE, 1_000_000n, ref);
  const r = await waitFor(id, ['FAKE'], t); return { observed: r.state, ms: r.ms, saleId: id };
});
await runCase(6, 'UNMATCHED (no comment) then attach', 'PAID', async () => {
  const id = arm('1.00', 'USDT');
  const t = Date.now(); await sendJetton(GOOD, 1_000_000n, null);
  const u = await waitFor(id, ['UNMATCHED'], t);
  if (u.state !== 'UNMATCHED') return { observed: 'step1 ' + u.state, ms: u.ms, saleId: id };
  const st = svc.status(DEVICE);
  svc.attach(DEVICE, id, st.unmatched.paymentId);
  return { observed: stateOf(id), ms: u.ms, saleId: id, note: 'UNMATCHED seen after ' + u.ms + ' ms, then attach via service' };
});
await runCase(7, 'LATE: pay a voided sale', 'LATE', async () => {
  const id = arm('1.00', 'USDT'); const ref = newRef(id);
  svc.void(DEVICE, id);
  const t = Date.now(); await sendJetton(GOOD, 1_000_000n, ref);
  const r = await waitFor(id, ['LATE'], t); return { observed: r.state, ms: r.ms, saleId: id };
});
await runCase(8, 'GRAM sale PAID: 0.05 GRAM', 'PAID', async () => {
  const id = arm('0.05', 'GRAM'); const ref = newRef(id);
  const t = Date.now(); await sendGram(ref, toNano('0.05'));
  const r = await waitFor(id, ['PAID'], t); return { observed: r.state, ms: r.ms, saleId: id };
});

const okAll = rows.filter((r) => r.ok).length;
const hex = (h: string) => tonviewerLink(h).split('/').pop()!;
const link = (h: string) => '[' + hex(h).slice(0, 8) + '](' + tonviewerLink(h) + ')';
const md = [
  '# Live edge states (real TON testnet, real server service)', '',
  'Run: ' + new Date().toISOString() + '. In-process server/scripts/live-states.ts; fresh SQLite, TON Center v3 testnet, Telegram faked (no token).',
  'Seller: ' + friendly(merchant.address) + '. Customer: ' + friendly(cust.address) + '. Allowlisted USDT master: ' + jt.allowlisted.friendly + '. Fake master: ' + jt.fake.friendly + '.',
  'Latency = send accepted and seqno consumed -> service reached the expected state (includes request throttle and 1.5 s tick gap).', '',
  '| # | case | expected | observed | ok | latency ms | txs |', '|---|---|---|---|---|---|---|',
  ...rows.map((r) => '| ' + r.n + ' | ' + r.name + (r.note ? ' (' + r.note + ')' : '') + ' | ' + r.expected + ' | ' + r.observed + ' | ' + (r.ok ? 'yes' : 'NO') + ' | ' + (r.ms ?? '') + ' | ' + r.txs.map(link).join(' ') + ' |'),
  '', 'Result: ' + okAll + '/' + rows.length + ' as expected.', '',
];
writeFileSync(OUT, md.join('\n'));
console.log('\n' + md.join('\n'));
console.log('telegram messages recorded: ' + tg.log.length);
process.exit(okAll === rows.length ? 0 : 1);
