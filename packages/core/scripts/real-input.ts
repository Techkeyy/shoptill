// Read-only replay of the core payment checker against REAL mainnet incoming payments.
// No sends, no keys. Usage: npx tsx packages/core/scripts/real-input.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TonCenter, classify, parseRef, normalizeAddress } from '../src/index.ts';
import type { Allowlist, IncomingPayment, Sale } from '../src/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../../..');
const BASE = 'https://toncenter.com/api/v3'; // mainnet
const USDT_MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';
const WINDOW_S = 24 * 3600;
const REF = 'zz9test9';

// Busiest mainnet USDT receivers, from the 50 most recent `direction=in` USDT transfers
// (2026-11-23 query): 0:852443... received 24/50, 0:C6AD1F... received 3/50.
const ADDRESSES = [
  '0:852443F8599FE6A5DA34FE43049AC4E0BEB3071BB2BFB56635EA9421287C283A',
  '0:C6AD1F60098D2BFB71B210FE93FA97577DB9F61B6B6C0FE6B7EE87E603BA49BA',
];

const now = Math.floor(Date.now() / 1000);
const since = now - WINDOW_S;
const usdt = normalizeAddress(USDT_MASTER);
const allowlist: Allowlist = { native: true, jettonMasters: [USDT_MASTER] };
const tc = new TonCenter({ baseUrl: BASE, jettonDecimals: { [USDT_MASTER]: 6 } });
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '...' : s);
const isSpam = (p: IncomingPayment) =>
  (p.asset.kind === 'jetton' && normalizeAddress(p.asset.master) !== usdt) ||
  /http|t\.me/i.test(p.comment ?? '');

const verdicts: Record<string, number> = { COUNTED: 0, FAKE: 0, UNMATCHED: 0, IGNORED: 0, LATE: 0, DUPLICATE: 0 };
const cats = {
  total: 0, nativeTxs: 0, jettonTxs: 0, foreignJettonMasters: 0, linkComments: 0,
  failed: 0, stRefComments: 0, stRefOurRef: 0,
};
const violations: string[] = [];
const spamRows: string[] = [];
const perAddr: string[] = [];
let truncated = false;

for (const addr of ADDRESSES) {
  const native = await tc.getIncomingTransactions(addr, since);
  const jetton = await tc.getJettonTransfersTo(addr, since);
  if (native.length >= 100 || jetton.length >= 100) truncated = true;
  const all = [...native, ...jetton];
  const sale: Sale = {
    ref: REF, amountRaw: 1_000_000n, asset: { kind: 'jetton', master: USDT_MASTER },
    createdAt: since, expiresAt: now + 900, voidedAt: null,
  };
  const res = classify(sale, all, allowlist, now);
  perAddr.push(`${trunc(addr, 14)}: native=${native.length} jetton=${jetton.length} state=${res.state}`);

  for (const c of res.payments) {
    const p = c.payment;
    verdicts[c.verdict] = (verdicts[c.verdict] ?? 0) + 1;
    cats.total++;
    if (p.asset.kind === 'native') cats.nativeTxs++; else cats.jettonTxs++;
    if (p.asset.kind === 'jetton' && normalizeAddress(p.asset.master) !== usdt) cats.foreignJettonMasters++;
    if (/http|t\.me/i.test(p.comment ?? '')) cats.linkComments++;
    if (!p.success) cats.failed++;
    const pr = parseRef(p.comment);
    if (pr) { cats.stRefComments++; if (pr.ref === REF) cats.stRefOurRef++; }

    if (c.verdict === 'COUNTED' || c.verdict === 'FAKE') {
      violations.push(`${c.verdict} ${p.txHash} asset=${p.asset.kind} comment=${JSON.stringify(p.comment)} reason=${c.reason}`);
    }
    if (c.verdict === 'COUNTED' && !p.success) violations.push(`COUNTED on failed tx ${p.txHash}`);
    if (c.verdict === 'COUNTED' && p.asset.kind === 'jetton' && normalizeAddress(p.asset.master) !== usdt) {
      violations.push(`COUNTED non-allowlisted master ${p.txHash}`);
    }
    if (isSpam(p) && spamRows.length < 5) {
      const master = p.asset.kind === 'jetton' ? trunc(p.asset.master, 20) : 'native';
      spamRows.push(`| ${p.asset.kind === 'jetton' ? 'jetton' : 'native'} | ${master} | ${trunc(p.comment ?? '-', 40)} | ${p.success ? 'ok' : 'failed'} | ${p.txHash} |`);
    }
  }
}

const passed = violations.length === 0;
const iso = new Date().toISOString();
const lines = [
  '# Real-input replay (mainnet, read-only)',
  '',
  `- Date: ${iso}`,
  `- Addresses (busiest USDT receivers, top of 50-row query): ${ADDRESSES.map((a) => trunc(a, 14)).join(', ')}`,
  `- Window: last 24 h (${new Date(since * 1000).toISOString()} to ${new Date(now * 1000).toISOString()})`,
  `- Fake sale: ref \`st:${REF}\`, 1 USDT, asset = mainnet USDT master, allowlist = native + that master`,
  `- Page cap: ${truncated ? 'HIT 100-row limit on at least one query (window may be incomplete)' : 'no query hit the 100-row page limit'}`,
  `- Per address: ${perAddr.join('; ')}`,
  '',
  '## Totals',
  '',
  `- Payments scanned: ${cats.total} (native ${cats.nativeTxs}, jetton ${cats.jettonTxs})`,
  `- Verdicts: COUNTED ${verdicts.COUNTED}, FAKE ${verdicts.FAKE}, UNMATCHED ${verdicts.UNMATCHED}, IGNORED ${verdicts.IGNORED}, LATE ${verdicts.LATE}, DUPLICATE ${verdicts.DUPLICATE}`,
  `- Non-allowlisted jetton masters: ${cats.foreignJettonMasters}`,
  `- Comments containing http or t.me: ${cats.linkComments}`,
  `- Failed or bounced: ${cats.failed}`,
  `- Comments that parse as an st: ref: ${cats.stRefComments} (of which our ref: ${cats.stRefOurRef})`,
  '',
  '## Example spam / scam payments',
  '',
  '| Kind | Asset master | Comment (40 chars) | Status | Tx hash |',
  '|---|---|---|---|---|',
  ...(spamRows.length ? spamRows : ['| - | - | - | - | none found |']),
  '',
  '## Verdict',
  '',
  passed
    ? `PASS: no false PAID on ${cats.total} real payments (COUNTED 0, FAKE 0, no spam/failed counted).`
    : `FAIL: ${violations.length} violation(s):\n${violations.map((v) => `- ${v}`).join('\n')}`,
  '',
];

const out = resolve(ROOT, 'evidence/real-input.md');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, lines.join('\n'));

console.log(lines.join('\n'));
console.log(`\nWrote ${out}`);
if (!passed) process.exitCode = 1;
