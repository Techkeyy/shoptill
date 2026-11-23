import { writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Address, beginCell, internal, SendMode, toNano } from '@ton/core';
import { JettonMinter } from '@ton-community/assets-sdk';
import { classify, TonCenter, type Allowlist, type IncomingPayment, type Sale } from '../src/index.ts';
import { client, friendly, loadWallet, readSecretJson, retry, ROOT, sleep } from './common.ts';

const c = client();
const merchant = await loadWallet('merchant');
const cust = await loadWallet('customer');
const jt = readSecretJson('testnet-jettons.json');
const cfg = JSON.parse(readFileSync(resolve(ROOT, 'packages/core/testnet.config.json'), 'utf8'));
const allow: Allowlist = { native: true, jettonMasters: [cfg.allowlistedJettonMaster] };
const tc = new TonCenter({ jettonDecimals: { [cfg.allowlistedJettonMaster]: 6, [jt.fake.master]: 6 } });
const opened = c.open(cust.contract);

const mAddr = friendly(merchant.address);
const refId = () => Math.random().toString(36).slice(2, 8).replace(/[^a-z0-9]/g, 'x');
const commentCell = (t: string) => beginCell().storeUint(0, 32).storeStringTail(t).endCell();

async function sendMsg(to: Address, value: bigint, body: any, bounce: boolean) {
  const seqno = await retry(() => opened.getSeqno());
  await retry(() => opened.sendTransfer({
    seqno, secretKey: cust.kp.secretKey, sendMode: SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS,
    messages: [internal({ to, value, bounce, body })],
  }));
}
async function sendNative(ref: string, amount: bigint) {
  await sendMsg(merchant.address, amount, commentCell(`st:${ref}`), false); // seller wallet may be uninit: non-bounceable
}
async function sendJetton(master: string, ref: string, amount: bigint) {
  const minter = c.open(JettonMinter.createFromAddress(Address.parse(master)));
  const jw = await retry(() => minter.getWalletAddress(cust.address));
  const body = beginCell().storeUint(0x0f8a7ea5, 32).storeUint(0, 64).storeCoins(amount)
    .storeAddress(merchant.address).storeAddress(cust.address).storeBit(0)
    .storeCoins(toNano('0.01'))
    .storeBit(1).storeRef(commentCell(`st:${ref}`)).endCell();
  await sendMsg(jw, toNano('0.1'), body, true);
}

async function detect(kind: 'native' | 'jetton', ref: string, since: number): Promise<IncomingPayment[]> {
  for (;;) {
    const ps = kind === 'native'
      ? await tc.getIncomingTransactions(mAddr, since)
      : await tc.getJettonTransfersTo(mAddr, since);
    if (ps.some((p) => p.comment?.toLowerCase().trim() === `st:${ref}`)) return ps;
    if (Date.now() / 1000 - since > 180) throw new Error('timeout waiting for ' + ref);
  }
}

const rows: any[] = [];
const rounds: [string, 'native' | 'jetton', string | null][] = [
  ...Array.from({ length: 5 }, () => ['native GRAM', 'native', null] as [string, 'native', null]),
  ...Array.from({ length: 5 }, () => ['allowlisted USDT', 'jetton', cfg.allowlistedJettonMaster] as [string, 'jetton', string]),
  ['FAKE USDT', 'jetton', jt.fake.master],
];
for (const [label, kind, master] of rounds) {
  const ref = refId();
  const since = Math.floor(Date.now() / 1000) - 5;
  const sale: Sale = {
    ref, createdAt: since, expiresAt: since + 900, voidedAt: null,
    asset: kind === 'native' ? { kind: 'native' } : { kind: 'jetton', master: cfg.allowlistedJettonMaster },
    amountRaw: kind === 'native' ? toNano('0.1') : 1_000_000n,
  };
  if (kind === 'native') await sendNative(ref, sale.amountRaw); else await sendJetton(master!, ref, 1_000_000n);
  const tSent = Date.now();
  const ps = await detect(kind, ref, since);
  const tSeen = Date.now();
  const res = classify(sale, ps, allow, Math.floor(Date.now() / 1000));
  const hit = ps.find((p) => p.comment?.toLowerCase().trim() === `st:${ref}`)!;
  const expected = label === 'FAKE USDT' ? 'FAKE' : 'PAID';
  rows.push({ label, ref, tx: hit.txHash, latencyMs: tSeen - tSent, state: res.state, ok: res.state === expected });
  console.log(rows.at(-1));
  await sleep(2000);
}

const md = [
  '# P0 spike evidence', '',
  `Run: ${new Date().toISOString()} (TON Center v3 testnet, API key: ${process.env.TONCENTER_API_KEY ? 'yes' : 'no'})`,
  `Merchant: ${friendly(merchant.address)}`, `Customer: ${friendly(cust.address)}`,
  `Allowlisted USDT master: ${cfg.allowlistedJettonMasterFriendly}`, `Fake USDT master: ${jt.fake.friendly}`, '',
  'latency = send accepted by toncenter v2 -> matching payment returned by v3 via our client (includes 1.1s request throttle)', '',
  '| # | case | ref | tx hash | latency ms | classified | as expected |', '|---|---|---|---|---|---|---|',
  ...rows.map((r, i) => `| ${i + 1} | ${r.label} | ${r.ref} | ${r.tx} | ${r.latencyMs} | ${r.state} | ${r.ok} |`),
  '', `Correct: ${rows.filter((r) => r.ok).length}/${rows.length}`,
  `Max latency: ${Math.max(...rows.map((r) => r.latencyMs))} ms`, '',
];
writeFileSync(resolve(ROOT, 'evidence/p0-spike.md'), md.join('\n'));
console.log(md.join('\n'));
